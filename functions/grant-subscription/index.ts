// ============================================================
// grant-subscription — 标记用户订阅状态（管理员/支付回调）
//
// 鉴权：请求头 Authorization: Bearer <ADMIN_SECRET>
//   ADMIN_SECRET 来自函数 secrets（部署方生成，绝不进前端）。
//
// 动作（action 字段）：
//   grant     upsert 订阅：{user_id, plan, days} => active + expires_at
//   revoke    停用订阅：{user_id} => subscription_status='inactive'
//   get       查询订阅：{user_id} => 返回 profile
//
// 用途：测试期手动标记订阅（真实支付接入后由支付 Webhook 调用）。
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const ADMIN_SECRET = Deno.env.get('ADMIN_SECRET') || '';

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

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${ADMIN_SECRET}`;
}

const PLANS = ['free', 'basic', 'pro', 'team'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!isAuthorized(req)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const action = (body.action as string) || 'grant';
  const userId = ((body.user_id as string) || '').trim();

  if (!userId) return json({ error: 'user_id is required' }, 400);

  try {
    switch (action) {
      case 'grant': {
        const plan = (body.plan as string) || 'pro';
        if (!PLANS.includes(plan)) {
          return json({ error: `plan must be one of: ${PLANS.join(', ')}` }, 400);
        }
        const days = Math.max(1, Math.min(Number(body.days) || 30, 3650));
        const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
        const { data, error } = await sb.from('lic_user_profiles').upsert(
          {
            user_id: userId,
            plan,
            subscription_status: 'active',
            expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        ).select('user_id, plan, subscription_status, expires_at, updated_at').single();
        if (error) throw error;
        return json({ ok: true, action: 'grant', profile: data });
      }

      case 'revoke': {
        const { data, error } = await sb.from('lic_user_profiles').update({
          subscription_status: 'inactive',
          updated_at: new Date().toISOString(),
        }).eq('user_id', userId)
          .select('user_id, plan, subscription_status, expires_at').maybeSingle();
        if (error) throw error;
        return json({ ok: true, action: 'revoke', profile: data ?? null });
      }

      case 'get': {
        const { data, error } = await sb.from('lic_user_profiles')
          .select('user_id, plan, subscription_status, expires_at, updated_at')
          .eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return json({ ok: true, action: 'get', profile: data ?? null });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('grant-subscription error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
