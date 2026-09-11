// ============================================================
// create-token — 用户自助创建 SDK Token（需登录）
//
// 鉴权：verify_jwt=true（Supabase 网关验签），函数内 getUser()
//   再次确认真实用户身份。前端调用时携带
//   Authorization: Bearer <session.access_token>。
//
// 流程：
//   1. 取当前登录用户（无效 JWT => 401）
//   2. 查 user_profiles：订阅 active 且未到期 => 允许创建，否则 403
//   3. 每人活跃 token 上限 20 个
//   4. 生成 cvt_ 前缀 token（crypto 随机 40 hex），expire_date=订阅到期日
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const PROJECT_ID =
  Deno.env.get('PROJECT_ID') || '885e7f27-f4ad-447d-8f17-e18fac1dcf0a';

const MAX_ACTIVE_TOKENS = 20;
const TOKEN_PREFIX = 'cvt_';
const TOKEN_HEX_LEN = 40;

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

/** 生成 cvt_ + 40 位十六进制随机串 */
function generateToken(): string {
  const buf = crypto.getRandomValues(new Uint8Array(TOKEN_HEX_LEN / 2));
  let hex = '';
  for (const b of buf) hex += b.toString(16).padStart(2, '0');
  return TOKEN_PREFIX + hex;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }
  const name = (body.name ?? '').trim().slice(0, 60) || '默认令牌';

  // 服务端 client（service_role）做数据操作；用户 JWT 仅显式传给 getUser()
  // 验证身份 —— 不能放 global.headers，否则 PostgREST 会以用户角色执行，
  // 被 RLS 拒绝写入。
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
    // 1. 订阅检查
    const { data: profile, error: pErr } = await sb
      .from('lic_user_profiles')
      .select('plan, subscription_status, expires_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (pErr) throw pErr;

    const subscribed =
      profile &&
      profile.subscription_status === 'active' &&
      profile.expires_at &&
      new Date(profile.expires_at).getTime() > Date.now();
    if (!subscribed) {
      return json(
        { ok: false, error: 'no_subscription', message: '当前账号没有有效订阅，无法创建 Token。请先订阅或联系管理员。' },
        403,
      );
    }

    // 2. 活跃 token 数量上限
    const { count, error: cntErr } = await sb
      .from('lic_user_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_active', true);
    if (cntErr) throw cntErr;
    if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
      return json(
        { ok: false, error: 'token_limit', message: `活跃 Token 已达上限（${MAX_ACTIVE_TOKENS} 个），请先吊销不再使用的 Token。` },
        429,
      );
    }

    // 3. 创建 token（expire_date 跟随订阅到期日）
    let token = '';
    for (let i = 0; i < 3; i++) {
      token = generateToken();
      const { error: insErr } = await sb.from('lic_user_tokens').insert({
        project_id: PROJECT_ID,
        user_id: userId,
        token,
        name,
        plan: profile.plan,
        is_active: true,
        expire_date: profile.expires_at,
        used_count: 0,
      });
      if (!insErr) break;
      if (i === 2) throw insErr; // 唯一键冲突重试 3 次后放弃
    }

    const { data: created } = await sb
      .from('lic_user_tokens')
      .select('token, name, plan, is_active, expire_date, used_count, created_at')
      .eq('user_id', userId)
      .eq('token', token)
      .single();

    return json({ ok: true, token: created });
  } catch (err) {
    console.error('create-token error:', err);
    return json({ ok: false, error: 'server_error' }, 500);
  }
});
