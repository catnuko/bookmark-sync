// ============================================================
// bsync-creem-checkout — 登录用户发起 Creem 订阅支付
//
// 鉴权：verify_jwt=true（Supabase 网关验签），函数内 getUser()
//   再次确认真实用户身份（同 create-token 约定）。
//
// 流程：
//   1. 取当前登录用户（无效 JWT => 401）
//   2. body.plan ∈ {plus, pro}，查对应 Creem 产品 ID（secrets）
//   3. 调 Creem POST /v1/checkouts 创建收银台会话，
//      metadata 带 user_id/plan，webhook 回来靠它定位用户
//   4. 返回 checkout_url，扩展端打开该 URL 完成支付
//
// Secrets：CREEM_API_KEY / CREEM_PRODUCT_PLUS / CREEM_PRODUCT_PRO
//          （可选 CREEM_API_BASE，沙箱用 https://test-api.creem.io）
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const CREEM_API_KEY = Deno.env.get('CREEM_API_KEY') || '';
const CREEM_API_BASE = Deno.env.get('CREEM_API_BASE') || 'https://api.creem.io';
const PRODUCT_BY_PLAN: Record<string, string> = {
  plus: Deno.env.get('CREEM_PRODUCT_PLUS') || '',
  pro: Deno.env.get('CREEM_PRODUCT_PRO') || '',
};
const SUCCESS_URL =
  Deno.env.get('CREEM_SUCCESS_URL') || 'https://bookmarksync.app/pricing?checkout=success';

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

  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const plan = (body.plan || '').toLowerCase();
  const productId = PRODUCT_BY_PLAN[plan];
  if (!productId) {
    return json({ ok: false, error: 'invalid_plan', message: 'plan 必须是 plus 或 pro' }, 400);
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
  const user = userData.user;

  try {
    const res = await fetch(`${CREEM_API_BASE}/v1/checkouts`, {
      method: 'POST',
      headers: {
        'x-api-key': CREEM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        product_id: productId,
        request_id: `${user.id}:${plan}:${Date.now()}`,
        success_url: SUCCESS_URL,
        customer: user.email ? { email: user.email } : undefined,
        metadata: { user_id: user.id, plan },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.checkout_url) {
      console.error('creem checkout failed:', res.status, JSON.stringify(data));
      return json({ ok: false, error: 'checkout_failed', message: '创建支付会话失败，请稍后重试' }, 502);
    }
    return json({ ok: true, checkout_url: data.checkout_url, checkout_id: data.id });
  } catch (e) {
    console.error('creem-checkout error:', e);
    return json({ ok: false, error: 'internal', message: '服务异常，请稍后重试' }, 500);
  }
});
