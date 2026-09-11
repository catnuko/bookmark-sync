// ============================================================
// revoke-token — 个人主页：吊销自己的 SDK Token（需登录）
//
// 鉴权：verify_jwt=true + getUser()。
// 吊销 = is_active=false（保留记录可审计，校验立即失效）。
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const PROJECT_ID =
  Deno.env.get('PROJECT_ID') || '885e7f27-f4ad-447d-8f17-e18fac1dcf0a';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const token = (body.token ?? '').trim();
  if (!token) {
    return json({ ok: false, error: 'token is required' }, 400);
  }

  // 服务端 client（service_role）；用户 JWT 显式传给 getUser() 验证身份
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
    // 仅能吊销自己的 token（user_id 条件双重限制）
    const { data: updated, error } = await sb
      .from('lic_user_tokens')
      .update({ is_active: false })
      .eq('project_id', PROJECT_ID)
      .eq('user_id', userId)
      .eq('token', token)
      .eq('is_active', true)
      .select('token, name, is_active, expire_date, used_count')
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return json({ ok: false, error: 'not_found', message: '未找到该 Token，或它已处于吊销状态。' }, 404);
    }

    return json({ ok: true, token: updated });
  } catch (err) {
    console.error('revoke-token error:', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});
