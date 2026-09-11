// ============================================================
// generate-license — 激活码管理（仅管理员可调用）
//
// 鉴权（Task 2.4）：请求头 Authorization: Bearer <ADMIN_KEY>
//   ADMIN_KEY 来自函数 secrets（由部署方生成并保管，绝不进前端）。
//
// 动作（action 字段）：
//   create      生成新激活码（默认 1 个，count 可批量；days=有效期天数；
//               maxUsage=最大使用次数）
//   deactivate  禁用：is_active=false
//   activate    启用：is_active=true
//   extend      延长：expire_date += days
//   list        列出该租户下激活码（limit 默认 50）
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const ADMIN_KEY = Deno.env.get('ADMIN_KEY') || '';
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

/** 生成 XXXX-XXXX-XXXX-XXXX 格式激活码（去除易混淆字符） */
function generateKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => {
    const buf = crypto.getRandomValues(new Uint8Array(4));
    let s = '';
    for (const b of buf) s += chars[b % chars.length];
    return s;
  };
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

function isAuthorized(req: Request): boolean {
  if (!ADMIN_KEY) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${ADMIN_KEY}`;
}

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
  const action = (body.action as string) || 'create';
  const key = ((body.license_key as string) || '').trim();

  try {
    switch (action) {
      case 'create': {
        const count = Math.min(Math.max(Number(body.count) || 1, 1), 100);
        const days = Number(body.days) || 365;
        const maxUsage = Number(body.maxUsage) || 1;
        const rows = [];
        for (let i = 0; i < count; i++) {
          const licenseKey = generateKey();
          const { data, error } = await sb.from('licenses').insert({
            project_id: PROJECT_ID,
            license_key: licenseKey,
            expire_date: new Date(Date.now() + days * 86_400_000).toISOString(),
            is_active: true,
            max_usage: maxUsage,
            used_count: 0,
          }).select('license_key, expire_date, max_usage').single();
          if (error) throw error;
          rows.push(data);
        }
        return json({ ok: true, action: 'create', created: rows });
      }

      case 'deactivate':
      case 'activate': {
        if (!key) return json({ error: 'license_key is required' }, 400);
        const { data, error } = await sb
          .from('licenses')
          .update({ is_active: action === 'activate' })
          .eq('project_id', PROJECT_ID)
          .eq('license_key', key)
          .select('license_key, is_active, expire_date, max_usage, used_count')
          .single();
        if (error || !data) {
          return json({ error: 'license_key not found' }, 404);
        }
        return json({ ok: true, action, license: data });
      }

      case 'extend': {
        if (!key) return json({ error: 'license_key is required' }, 400);
        const days = Number(body.days) || 0;
        if (days <= 0) return json({ error: 'days must be > 0' }, 400);
        const { data, error } = await sb.rpc('extend_license', {
          p_project: PROJECT_ID,
          p_key: key,
          p_days: days,
        });
        if (error || !data) {
          return json({ error: 'license_key not found' }, 404);
        }
        return json({ ok: true, action: 'extend', license: data });
      }

      case 'list': {
        const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
        const { data, error } = await sb
          .from('licenses')
          .select('license_key, expire_date, is_active, max_usage, used_count, last_used_at, created_at')
          .eq('project_id', PROJECT_ID)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) throw error;
        return json({ ok: true, action: 'list', licenses: data });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('generate-license error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
