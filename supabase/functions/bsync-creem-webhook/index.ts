// ============================================================
// bsync-creem-webhook — Creem 支付事件回调（订阅开通/续费/取消的唯一写路径）
//
// 鉴权：verify_jwt=false（部署时 --no-verify-jwt），靠验签：
//   creem-signature = HMAC-SHA256(rawBody, CREEM_WEBHOOK_SECRET) 的 hex
//   （见 https://docs.creem.io/code/webhooks.md）
//
// 事件处理：
//   checkout.completed / subscription.active / subscription.paid
//       => 开通或续期：bsync_subscriptions upsert，
//          bsync_profiles 翻转 plan + quota_bytes
//   subscription.scheduled_cancel
//       => 已约取消：本期结束前仍可用（current_period_end 为准）
//   subscription.past_due
//       => 扣款失败重试中：记录状态，暂不停服务
//   subscription.canceled / expired / unpaid
//       => 立即降级回 free（5MB）
//   refund.created
//       => 订单标记 refunded（对账用，不自动降级，人工处理）
//
// Secrets：CREEM_WEBHOOK_SECRET
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const CREEM_WEBHOOK_SECRET = Deno.env.get('CREEM_WEBHOOK_SECRET') || '';

// plan => 同步配额（字节）。按 0035 校准（2KB/条）对齐条数承诺：
// Free 1MB（≈500 条）/ Plus 20MB（≈1 万条）/ Pro 500MB（≈25 万条封顶，数量不限档）。
// 必须与迁移 0035 的 bsync_effective_quota_bytes 映射保持一致。
const PLAN_QUOTA_BYTES: Record<string, number> = {
  free: 1 * 1024 * 1024,
  plus: 20 * 1024 * 1024,
  pro: 500 * 1024 * 1024,
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** HMAC-SHA256 hex（Web Crypto，Deno 原生支持） */
async function verifySignature(rawBody: string, signature: string): Promise<boolean> {
  if (!CREEM_WEBHOOK_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(CREEM_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // 常量时间比较，避免时序侧信道
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

interface CreemSubscriptionObject {
  id: string;
  status?: string;
  customer?: { id?: string } | string;
  metadata?: Record<string, unknown>;
  current_period_end_date?: string;
  current_period_start_date?: string;
  canceled_at?: string;
  items?: Array<{ product_id?: string }>;
  product?: { id?: string } | string;
}

interface CreemEvent {
  id?: string;
  eventType?: string;
  object?: Record<string, unknown>;
}

/** customer 字段可能是展开对象或纯 ID 字符串 */
function customerIdOf(obj: Record<string, unknown>): string | undefined {
  const c = obj.customer;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') return (c as { id?: string }).id;
  return undefined;
}

function productIdOf(obj: Record<string, unknown>): string | undefined {
  const p = obj.product;
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') return (p as { id?: string }).id;
  return obj.items?.[0]?.product_id as string | undefined;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const rawBody = await req.text();
  const signature = req.headers.get('creem-signature') || '';
  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    console.error('creem-webhook: invalid signature');
    return json({ error: 'invalid_signature' }, 401);
  }

  let event: CreemEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const eventType = event.eventType || 'unknown';
  const obj = (event.object || {}) as Record<string, unknown>;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // ---------- 提取公共字段 ----------
    const metadata = (obj.metadata || {}) as Record<string, unknown>;
    let userId = typeof metadata.user_id === 'string' ? metadata.user_id : undefined;
    let plan = typeof metadata.plan === 'string' ? metadata.plan.toLowerCase() : undefined;
    const subscriptionId =
      (typeof obj.id === 'string' && obj.id.startsWith('sub_') ? obj.id : undefined) ||
      (eventType === 'checkout.completed'
        ? typeof obj.subscription === 'string'
          ? obj.subscription
          : ((obj.subscription as { id?: string } | undefined)?.id ?? undefined)
        : undefined);

    // metadata 缺失时按订阅 ID 反查（如用户在 Creem 门户自助操作）
    if (!userId && subscriptionId) {
      const { data } = await sb
        .from('bsync_subscriptions')
        .select('user_id, plan')
        .eq('creem_subscription_id', subscriptionId)
        .maybeSingle();
      if (data) {
        userId = data.user_id;
        plan = plan || data.plan;
      }
    }
    if (!userId) {
      // 无法定位用户（如光顾但未登录过本产品的客户），记日志后确认接收，避免 Creem 无限重试
      console.warn(
        `creem-webhook: ${eventType} cannot resolve user_id`,
        JSON.stringify(obj).slice(0, 500),
      );
      return json({ ok: true, skipped: 'no_user' });
    }
    const customerId = customerIdOf(obj);

    // ---------- 订单流水（所有事件都记，对账用） ----------
    if (eventType.startsWith('checkout.') || eventType.startsWith('subscription.')) {
      await sb.from('bsync_orders').insert({
        user_id: userId,
        plan: plan || null,
        creem_checkout_id: typeof obj.checkout_id === 'string' ? obj.checkout_id : null,
        creem_order_id:
          typeof obj.order === 'string'
            ? obj.order
            : ((obj.order as { id?: string } | undefined)?.id ?? null),
        creem_subscription_id: subscriptionId || null,
        creem_customer_id: customerId || null,
        status: eventType.includes('paid') || eventType.includes('completed') ? 'paid' : 'pending',
        event_type: eventType,
        payload: obj,
      });
    }

    const isActivePlan = plan === 'plus' || plan === 'pro';

    // ---------- 开通 / 续期 ----------
    if (
      eventType === 'checkout.completed' ||
      eventType === 'subscription.active' ||
      eventType === 'subscription.paid'
    ) {
      if (!isActivePlan) {
        console.warn(`creem-webhook: ${eventType} unknown plan ${plan}`);
        return json({ ok: true, skipped: 'bad_plan' });
      }
      const subObj = obj as CreemSubscriptionObject;
      const status = subObj.status || 'active'; // scheduled_cancel 也按其真实状态落库
      const periodEnd = subObj.current_period_end_date || null;

      if (subscriptionId) {
        await sb.from('bsync_subscriptions').upsert(
          {
            user_id: userId,
            plan,
            status,
            creem_subscription_id: subscriptionId,
            creem_customer_id: customerId || null,
            current_period_end: periodEnd,
            canceled_at: subObj.canceled_at || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'creem_subscription_id' },
        );
      }

      // 降级与否取决于订阅是否仍生效：scheduled_cancel 到期前照样可用
      await sb
        .from('bsync_profiles')
        .update({
          plan,
          quota_bytes: PLAN_QUOTA_BYTES[plan],
          purchased_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      return json({ ok: true });
    }

    // ---------- 已约取消（本期结束前可用，等 expired 再降级） ----------
    if (eventType === 'subscription.scheduled_cancel') {
      const periodEnd = (obj as CreemSubscriptionObject).current_period_end_date || null;
      if (subscriptionId) {
        await sb
          .from('bsync_subscriptions')
          .update({
            status: 'scheduled_cancel',
            current_period_end: periodEnd,
            canceled_at: (obj as CreemSubscriptionObject).canceled_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('creem_subscription_id', subscriptionId);
      }
      return json({ ok: true });
    }

    // ---------- 扣款失败重试中：宽限期，暂不停服 ----------
    if (eventType === 'subscription.past_due' || eventType === 'subscription.paused') {
      if (subscriptionId) {
        await sb
          .from('bsync_subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('creem_subscription_id', subscriptionId);
      }
      return json({ ok: true });
    }

    // ---------- 终态：立即降级回 free ----------
    if (
      eventType === 'subscription.canceled' ||
      eventType === 'subscription.expired' ||
      eventType === 'subscription.unpaid'
    ) {
      if (subscriptionId) {
        await sb
          .from('bsync_subscriptions')
          .update({
            status: eventType === 'subscription.canceled' ? 'canceled' : 'expired',
            canceled_at: (obj as CreemSubscriptionObject).canceled_at || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('creem_subscription_id', subscriptionId);
      }
      await sb
        .from('bsync_profiles')
        .update({ plan: 'free', quota_bytes: PLAN_QUOTA_BYTES.free })
        .eq('user_id', userId);
      return json({ ok: true });
    }

    // ---------- 退款（对账用，降级走人工） ----------
    if (eventType === 'refund.created') {
      const orderId =
        typeof obj.order === 'string'
          ? obj.order
          : ((obj.order as { id?: string } | undefined)?.id ?? null);
      if (orderId) {
        await sb.from('bsync_orders').update({ status: 'refunded' }).eq('creem_order_id', orderId);
      }
      return json({ ok: true });
    }

    // 其他事件（subscription.update 等）确认接收即可
    return json({ ok: true, ignored: eventType });
  } catch (e) {
    console.error('creem-webhook error:', e);
    // 返回 500 让 Creem 重试
    return json({ error: 'internal' }, 500);
  }
});
