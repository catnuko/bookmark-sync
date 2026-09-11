// ============================================================
// my-tokens — 个人主页：列出当前用户的全部 SDK Token（需登录）
//
// 鉴权：verify_jwt=true + getUser()，与 create-token 一致。
// 返回字段含 token 全文（仅本人可见），供复制到 JS 插件使用。
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
    const { data: tokens, error } = await sb
      .from('user_tokens')
      .select('token, name, plan, is_active, expire_date, used_count, created_at, last_used_at')
      .eq('user_id', userId)
      .eq('project_id', PROJECT_ID)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    return json({ ok: true, tokens });
  } catch (err) {
    console.error('my-tokens error:', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});
