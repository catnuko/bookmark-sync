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
//   subscription.past_due / paused
//       => 扣款失败重试中：记录状态，暂不停服务
//   subscription.canceled / scheduled_cancel / expired / unpaid
//       => 按**账期**决定：current_period_end 未到 → 保留 plan、status 记
//          scheduled_cancel；已到 → 降级 free。
//          不能对 canceled 无条件降级：门户取消后 current_period_end_date 仍指向
//          本期末（实测取消于 2026-09-28、到期日 2027-09-28），立即降级等于吞掉
//          用户已付费的整年服务。到期兜底见迁移 0044 的每日任务。
//   refund.created
//       => 订单标记 refunded（对账用，不自动降级，人工处理）。
//          object 是「退款」不是「订阅」：订单号在 object.transaction.order，
//          metadata/订阅在 object.subscription —— 读顶层会静默丢单。
//
// Secrets：CREEM_WEBHOOK_SECRET
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const CREEM_WEBHOOK_SECRET = Deno.env.get('CREEM_WEBHOOK_SECRET') || '';

// plan => 同步配额（字节）。按 2KB/条 校准对齐条数承诺：
// Free 5MB（1,000 条）/ Plus 20MB（≈1 万条）/ Pro 500MB（≈25 万条封顶，数量不限档）。
// ★ 必须与迁移 0048 的 bsync_effective_quota_bytes 映射保持一致——两处不一致
//   会让「降级用户」与「存量用户」拿到不同额度（0035 到 0048 之间的分裂就是这么来的）。
const PLAN_QUOTA_BYTES: Record<string, number> = {
  free: 5 * 1024 * 1024,
  plus: 20 * 1024 * 1024,
  pro: 500 * 1024 * 1024,
};

// 邮箱兜底时 metadata.plan 同样缺失，只能靠 product_id 推出档位。
// 与 bsync-creem-checkout 的 PRODUCT_BY_PLAN 同源（同一批 secrets）。
// 空串表示该档位的 secret 没配→ 不会误判，只有配了才生效。
const PRODUCT_PLUS_ID = Deno.env.get('CREEM_PRODUCT_PLUS') || '';
const PRODUCT_PRO_ID = Deno.env.get('CREEM_PRODUCT_PRO') || '';

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

/**
 * 取付款人邮箱。Creem 各事件的 customer 形状不一致：多数事件是展开对象带
 * `email`，退款样例里挂在嵌套的 transaction.customer 上。
 * ★ 这是绕开官网直接付款的匿名订单**唯一**能定位买家的线索（见 resolveUserId）。
 */
function customerEmailOf(obj: Record<string, unknown>): string | undefined {
  const pick = (c: unknown): string | undefined => {
    if (c && typeof c === 'object') {
      const e = (c as { email?: unknown }).email;
      if (typeof e === 'string' && e.includes('@')) return e.trim().toLowerCase();
    }
    return undefined;
  };
  return (
    pick(obj.customer) ||
    pick((obj.transaction as Record<string, unknown> | undefined)?.customer) ||
    pick((obj.subscription as Record<string, unknown> | undefined)?.customer)
  );
}

function productIdOf(obj: Record<string, unknown>): string | undefined {
  const p = obj.product;
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object') return (p as { id?: string }).id;
  return obj.items?.[0]?.product_id as string | undefined;
}

/**
 * 取事件里的订阅 ID。订阅事件（subscription.*）的 object **就是**订阅，ID 在顶层；
 * 收银台（checkout.completed）与退款（refund.created）的 object 是别的实体，订阅
 * 挂在嵌套的 `subscription` 上（收银台是展开对象，退款样例里 `transaction.subscription`
 * 是纯字符串）。只认 `sub_` 前缀，避免把 `ref_`/`ord_` 之类误当订阅。
 */
function subscriptionIdOf(obj: Record<string, unknown>): string | undefined {
  if (typeof obj.id === 'string' && obj.id.startsWith('sub_')) return obj.id;
  const sub = obj.subscription;
  if (typeof sub === 'string' && sub.startsWith('sub_')) return sub;
  if (sub && typeof sub === 'object') {
    const id = (sub as { id?: string }).id;
    if (typeof id === 'string' && id.startsWith('sub_')) return id;
  }
  const tx = obj.transaction;
  if (tx && typeof tx === 'object') {
    const s = (tx as { subscription?: unknown }).subscription;
    if (typeof s === 'string' && s.startsWith('sub_')) return s;
  }
  return undefined;
}

/**
 * 取事件里的订单 ID。收银台事件在顶层 `object.order`；**退款事件的 object 是「退款」**，
 * 订单藏在 `object.transaction.order`（文档样例即如此）—— 读错位置会让退款静默丢单，
 * `bsync_orders` 永远停在 paid，退款被当成营收。
 */
function orderIdOf(obj: Record<string, unknown>): string | null {
  const tx = obj.transaction;
  if (tx && typeof tx === 'object') {
    const o = (tx as { order?: unknown }).order;
    if (typeof o === 'string') return o;
    if (o && typeof o === 'object') return (o as { id?: string }).id ?? null;
  }
  const o = obj.order;
  if (typeof o === 'string') return o;
  if (o && typeof o === 'object') return (o as { id?: string }).id ?? null;
  return null;
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
    // metadata 不一定在顶层：退款事件的 object 是「退款」，metadata 挂在嵌套的
    // subscription 上（文档样例）。只读顶层会拿不到 user_id，事件被当「无关客户」
    // 静默丢弃（返回 skipped:no_user），退款永远不入账。
    const nestedSub =
      obj.subscription && typeof obj.subscription === 'object'
        ? (obj.subscription as Record<string, unknown>)
        : undefined;
    const metadata = ((obj.metadata ?? nestedSub?.metadata) || {}) as Record<string, unknown>;
    let userId = typeof metadata.user_id === 'string' ? metadata.user_id : undefined;
    let plan = typeof metadata.plan === 'string' ? metadata.plan.toLowerCase() : undefined;
    const subscriptionId = subscriptionIdOf(obj);

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

    // ---------- 邮箱兜底反查（绕开官网的匿名订单） ----------
    // Creem 为每个产品生成公开可购买的落地页（/product/prod_xxx），且后台**没有**
    // 关闭它的开关（实测：唯一的「启用公开店面」只管 /stores 聚合页，product 页照旧
    // 200 直达收银台）。于是任何人拿 prod_ ID 都能直接付款，而这条路径上的checkout
    // 由 Creem 自己生成，**不经过 bsync-creem-checkout → metadata 里没有 user_id**。
    // 结果：用户付了钱，webhook 解析不到买家 → 账号不开通 → 只能人工退款。
    // 这里用付款邮箱反查 Supabase Auth 找回user_id，让已付款的单自动到账。
    //
    // ★ 为什么必须用 service_role：auth.users 没有对外的 Data API 通道，
    //   RLS 也管不到它（它不是 public schema 的表）。createClient 用的正是
    //   SERVICE_ROLE_KEY，getUserByEmail 才能通。
    let resolvedBy = userId ? 'metadata' : undefined;
    if (!userId) {
      const email = customerEmailOf(obj);
      if (email) {
        const { data: found, error: authErr } = await sb.auth.admin.getUserByEmail(email);
        if (authErr) {
          console.warn(`creem-webhook: getUserByEmail failed (${eventType})`, authErr.message);
        } else if (found?.user?.id) {
          userId = found.user.id;
          resolvedBy = 'email';
          console.warn(
            `creem-webhook: ${eventType} resolved user by email fallback ` +
              `(${email.slice(0, 3)}***@${email.split('@')[1] || '?'})`,
          );
        }
      }
      // plan 也可能只有 product_id 可推。metadata 缺失时按产品 ID 反查档位，
      // 否则下面 isActivePlan 判false → 跳过开通，钱照样收不到。
      if (userId && !plan) {
        const pid = productIdOf(obj);
        if (pid && pid === PRODUCT_PLUS_ID) plan = 'plus';
        else if (pid && pid === PRODUCT_PRO_ID) plan = 'pro';
      }
    }

    if (!userId) {
      // 无法定位用户（如确实从未注册过本产品的陌生买家），记日志后确认接收，
      // 避免 Creem 无限重试。这类订单要人工退款，Creem 后台可按邮箱找到买家。
      console.warn(
        `creem-webhook: ${eventType} cannot resolve user_id`,
        JSON.stringify({ email: customerEmailOf(obj), obj }).slice(0, 500),
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
        creem_order_id: orderIdOf(obj),
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
      // 本分支的三种事件 object 形状不同：
      //   subscription.active / paid 的 object 是「订阅」，status 是订阅状态（active/trialing/...）；
      //   checkout.completed 的 object 是「收银台会话」，它的 status 是**收银台**生命周期
      //   （文档样例里是 completed），且压根没有 current_period_end_date。
      // 原样抄会犯两个错：把 'completed' 写进订阅状态列（门户/官网/后台都按订阅状态展示），
      // 以及把 current_period_end 清成 null。后者在事件重投/乱序时是**永久性**的
      // ——Creem 明确说 webhook 会重投，checkout.completed 晚于 subscription.active 到达时
      // 会把已写好的账期抹掉。收银台完成即订阅已生效，所以这里按 active 落，账期留给订阅事件。
      const isCheckout = eventType === 'checkout.completed';
      const status = isCheckout ? 'active' : subObj.status || 'active';

      if (subscriptionId) {
        // onConflict 用 **user_id**（本表主键，一人一行），不是 creem_subscription_id：
        // 用户「取消后重新订阅」会拿到新的 sub id，按 sub id 做冲突目标时那行命中不了，
        // 于是走 INSERT 撞上 pkey(user_id) 报 23505，台账就永远停在旧订阅上。
        // 唯一索引 bsync_subscriptions_creem_subscription_id_key（0043）仍在，
        // 它负责防「两个用户抢同一个 Creem 订阅」。
        const { error: subErr } = await sb.from('bsync_subscriptions').upsert(
          {
            user_id: userId,
            plan,
            status,
            creem_subscription_id: subscriptionId,
            creem_customer_id: customerId || null,
            // 订阅生命周期字段只在 subscription.* 事件里写：checkout.completed 上没有这些字段，
            // 带上它就会在重投时把 subscription.active 写好的账期覆盖成 null。
            ...(isCheckout
              ? {}
              : {
                  current_period_end: subObj.current_period_end_date || null,
                  canceled_at: subObj.canceled_at || null,
                }),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
        // 必须显式记日志：supabase-js 不把 PostgREST 错误当异常抛，漏检时表现为
        // 「webhook 返回 200、plan 也翻了，但订阅台账是空的」——0043 之前线上就是
        // 这个状态（42P10 被静默吞掉），坏的是售后（门户查不到 customer_id）。
        if (subErr) {
          console.error(
            `creem-webhook: subscription upsert failed (${eventType})`,
            JSON.stringify(subErr),
          );
        }
      }

      // 降级与否取决于订阅是否仍生效：scheduled_cancel 到期前照样可用
      const { error: profErr } = await sb
        .from('bsync_profiles')
        .update({
          plan,
          quota_bytes: PLAN_QUOTA_BYTES[plan],
          purchased_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      // 用户已付款，plan 没翻= 白付。必须显式记错误：supabase-js 不把 PostgREST
      // 错误当异常抛，漏检时表现为「webhook 返回 200、一切正常，用户却仍是 free」。
      if (profErr) {
        console.error(
          `creem-webhook: PROFILE UPDATE FAILED (${eventType}, via ${resolvedBy}) ` +
            `user=${userId} plan=${plan} —— 用户已付款但未开通，需人工处理:`,
          JSON.stringify(profErr),
        );
      }
      // 邮箱兜底开通的订单要留可检索的痕迹：这是「绕开官网直接付款」的唯一现场。
      if (resolvedBy === 'email') {
        console.warn(
          `creem-webhook: ORDER ACTIVATED VIA EMAIL FALLBACK (${eventType}) ` +
            `user=${userId} plan=${plan} sub=${subscriptionId || '-'}`,
        );
      }
      return json({ ok: true, resolved_by: resolvedBy || 'metadata' });
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

    // ---------- 取消 / 到期 / 欠费：按**账期**决定是否立即降级 ----------
    // Creem 的 canceled 语义是「不再续费」，不是「立即失效」：客户门户点取消后
    // object 里 current_period_end_date 仍指向本期末（实测取消于 2026-09-28、
    // 到期日 2027-09-28），文档也把「当期结束时取消」描述为在
    // current_period_end_date 之前保持 active。但**门户实际发的是 canceled 而不是
    // scheduled_cancel**（实测），所以这里必须自己按账期判断——否则用户关掉自动
    // 续费就立刻失去已付费的整年服务。
    if (
      eventType === 'subscription.canceled' ||
      eventType === 'subscription.scheduled_cancel' ||
      eventType === 'subscription.expired' ||
      eventType === 'subscription.unpaid'
    ) {
      const sub = obj as CreemSubscriptionObject;
      const periodEnd = sub.current_period_end_date || null;
      // expired 按定义就是账期已过；其余事件看本期是否还没走完
      const stillPaid =
        eventType !== 'subscription.expired' &&
        !!periodEnd &&
        new Date(periodEnd).getTime() > Date.now();

      if (subscriptionId) {
        await sb
          .from('bsync_subscriptions')
          .update({
            status: stillPaid
              ? 'scheduled_cancel'
              : eventType === 'subscription.canceled'
                ? 'canceled'
                : 'expired',
            canceled_at: sub.canceled_at || new Date().toISOString(),
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('creem_subscription_id', subscriptionId);
      }

      // 已付费周期没走完就保留 plan。到期由 subscription.expired 或迁移 0044 的
      // 每日兜底任务（bsync_expire_subscriptions）降级。
      if (!stillPaid) {
        await sb
          .from('bsync_profiles')
          .update({ plan: 'free', quota_bytes: PLAN_QUOTA_BYTES.free })
          .eq('user_id', userId);
      }
      return json({ ok: true });
    }

    // ---------- 退款：降级 free（不只是对账） ----------
    // 退款事件的 object 是「退款」：订单在object.transaction.order，订阅在
    // object.subscription（样例里 transaction.subscription 是纯字符串）。
    // 早期实现读 obj.order → 拿不到订单号 → 静默丢单，退款被计成营收。
    //
    // ★ 2026-10-08：原来这里只把订单标成 refunded 就返回，**从不降 profile**，
    //   而全函数唯一的降级点在上面的「取消/到期」分支（:425）—— 退款事件走不到那里，
    //   迁移 0044 的每日兜底也只扫「账期已过的取消态」，账期在未来的单子同样扫不到。
    //   结果：用户退款了，钱退了，plan 纹丝不动地继续用一年（线上就是这个状态：
    //   订单 status=refunded / profile plan=pro）。这是白嫖，不是设计。
    //
    //退款与取消是**两件不同的事**，不能共用判据：
    //   取消 = 不再续费，已付费的服务期还没结束 → 保留 plan（:399的 stillPaid 就是对的）
    //   退款 = 钱已经回来了还继续用 → 必须立刻降级，账期多长都无关
    //
    // 幂等：重复投递 refund.created 会重复降级，同一个值写两次，无副作用。
    if (eventType === 'refund.created') {
      const orderId = orderIdOf(obj);
      if (orderId) {
        await sb.from('bsync_orders').update({ status: 'refunded' }).eq('creem_order_id', orderId);
      } else {
        console.warn(
          `creem-webhook: refund.created 无订单号，无法对账`,
          JSON.stringify(obj).slice(0, 500),
        );
      }
      // 只在该用户没有**其他**仍生效的订阅时才降级：退款的是某一笔订单，
      // 用户可能还开着别处的订阅（例如升级 Pro 后对Plus 那笔退款）。直接无条件
      // 降级会把「退了旧订阅」的用户也一起打成 free —— 那是新的误伤。
      const { data: stillActive } = await sb
        .from('bsync_subscriptions')
        .select('creem_subscription_id, plan, status')
        .eq('user_id', userId)
        .neq('status', 'refunded')
        .not('creem_subscription_id', 'is', null);
      const otherLive = (stillActive || []).filter(
        (s) =>
          s.creem_subscription_id !== subscriptionId &&
          ['active', 'trialing', 'scheduled_cancel', 'past_due'].includes(s.status || ''),
      );

      if (otherLive.length > 0) {
        console.warn(
          `creem-webhook: refund.created 已退款，但该用户另有 ${otherLive.length} 个生效订阅 ` +
            `(${otherLive.map((s) => s.plan).join(',')})，保留现档位`,
        );
      } else {
        const { error: profErr } = await sb
          .from('bsync_profiles')
          .update({ plan: 'free', quota_bytes: PLAN_QUOTA_BYTES.free })
          .eq('user_id', userId);
        if (profErr) {
          console.error(
            `creem-webhook: REFUND DOWNGRADE FAILED user=${userId} —— 钱已退但会员未收回:`,
            JSON.stringify(profErr),
          );
        }
        console.warn(
          `creem-webhook: refund.created 已降级 free user=${userId} ` +
            `（订单 ${orderId || '无号'}，refund 前 plan=${plan || '未知'}）`,
        );
      }
      return json({ ok: true, downgraded: otherLive.length === 0 });
    }

    // 其他事件（subscription.update 等）确认接收即可
    return json({ ok: true, ignored: eventType });
  } catch (e) {
    console.error('creem-webhook error:', e);
    // 返回 500 让 Creem 重试
    return json({ error: 'internal' }, 500);
  }
});
