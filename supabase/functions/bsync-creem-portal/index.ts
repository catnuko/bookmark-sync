// ============================================================
// bsync-creem-portal — 登录用户打开 Creem 客户门户（取消/管理订阅）
//
// 鉴权：verify_jwt=true + getUser()（同 bsync-creem-checkout 约定）。
//
// 流程：
//   1. 取当前登录用户
//   2. 查 bsync_subscriptions 拿 creem_customer_id（无订阅 => 404）
//   3. 调 Creem POST /v1/customers/billing 生成门户链接
//   4. 门户里可取消订阅；取消后 Creem webhook 回调翻转本地状态
//
// Secrets：CREEM_API_KEY（可选 CREEM_API_BASE）
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const CREEM_API_KEY = Deno.env.get('CREEM_API_KEY') || '';
const CREEM_API_BASE = Deno.env.get('CREEM_API_BASE') || 'https://api.creem.io';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!CREEM_API_KEY) {
    return json({ ok: false, error: 'not_configured', message: '支付渠道未配置（缺少 CREEM_API_KEY）' }, 500);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  const userId = userData.user.id;

  try {
    const { data: sub, error: subErr } = await sb
      .from('bsync_subscriptions')
      .select('creem_customer_id, status')
      .eq('user_id', userId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!sub?.creem_customer_id) {
      return json(
        { ok: false, error: 'no_subscription', message: '当前账号没有订阅记录，无需管理。' },
        404,
      );
    }

    const res = await fetch(`${CREEM_API_BASE}/v1/customers/billing`, {
      method: 'POST',
      headers: {
        'x-api-key': CREEM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customer_id: sub.creem_customer_id }),
    });
    const data = await res.json().catch(() => ({}));
    const link = data?.customer_portal_link;
    if (!res.ok || !link) {
      console.error('creem portal failed:', res.status, JSON.stringify(data));
      return json({ ok: false, error: 'portal_failed', message: '生成管理链接失败，请稍后重试' }, 502);
    }
    return json({ ok: true, portal_url: link, subscription_status: sub.status });
  } catch (e) {
    console.error('creem-portal error:', e);
    return json({ ok: false, error: 'internal', message: '服务异常，请稍后重试' }, 500);
  }
});
