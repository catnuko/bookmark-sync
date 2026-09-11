// ============================================================
// validate-license — 激活码 / SDK Token 验证（公网可调用，无需登录）
//
// 职责（Task 2.2 / 2.3 / 6.3 + Token 扩展）：
//   1. 两种凭据二选一：
//        { license_key }  —— 管理员生成的激活码（consume_license）
//        { token }        —— 用户自助 SDK Token（consume_token）
//   2. 校验是否存在 / 是否禁用 / 是否过期 / 是否超量（激活码）
//   3. 校验通过则原子消费（used_count+1），并发安全
//   4. 记录使用日志（IP / User-Agent / 结果）
//   5. 简单限流：同一 IP 60 秒内最多 10 次
//
// 安全模型：函数持有 service_role 密钥（服务端 secrets），
//   客户端只调用本函数的公网 URL，永远接触不到数据库密钥。
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
const PROJECT_ID =
  Deno.env.get('PROJECT_ID') || '885e7f27-f4ad-447d-8f17-e18fac1dcf0a';

const RATE_LIMIT_WINDOW_MS = 60_000; // 60 秒窗口
const RATE_LIMIT_MAX = 10; // 单 IP 窗口内最大请求数

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || null;
}

async function writeLog(
  sb: ReturnType<typeof createClient>,
  key: string,
  ip: string | null,
  ua: string | null,
  result: string,
) {
  try {
    await sb.from('lic_usage_logs').insert({
      project_id: PROJECT_ID,
      license_key: key,
      ip,
      user_agent: ua,
      result,
    });
  } catch {
    // 日志写入失败不阻塞主流程
  }
}

async function isRateLimited(
  sb: ReturnType<typeof createClient>,
  ip: string | null,
): Promise<boolean> {
  if (!ip) return false;
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await sb
    .from('lic_usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', PROJECT_ID)
    .eq('ip', ip)
    .gte('request_time', since);
  if (error) return false;
  return (count ?? 0) >= RATE_LIMIT_MAX;
}

Deno.serve(async (req: Request) => {
  // CORS 预检（Task 2.3）
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ valid: false, error: 'Method not allowed' }, 405);
  }

  let body: { license_key?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return json({ valid: false, error: 'Invalid JSON body' }, 400);
  }
  const token = (body.token ?? '').trim();
  const key = (body.license_key ?? '').trim();
  const isTokenMode = !key && !!token;
  const credential = isTokenMode ? token : key;
  if (!credential) {
    return json({ valid: false, error: 'license_key or token is required' }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const ip = clientIp(req);
  const ua = req.headers.get('user-agent') || null;

  // 限流（Task 6.3）
  if (await isRateLimited(sb, ip)) {
    await writeLog(sb, credential, ip, ua, 'rate_limited');
    return json(
      { valid: false, reason: 'rate_limited', error: '请求过于频繁，请稍后再试' },
      429,
    );
  }

  // 原子校验 + 消费（数据库函数保证并发安全）
  const { data, error } = isTokenMode
    ? await sb.rpc('lic_consume_token', { p_token: token })
    : await sb.rpc('lic_consume_license', {
        p_project: PROJECT_ID,
        p_key: key,
      });

  if (error) {
    await writeLog(sb, credential, ip, ua, 'error');
    return json({ valid: false, error: 'Server error' }, 500);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row || !row.ok) {
    const reason = row?.reason ?? 'invalid';
    await writeLog(sb, credential, ip, ua, reason);
    return json({
      valid: false,
      reason,
      message: reasonMessage(reason, isTokenMode),
    });
  }

  await writeLog(sb, credential, ip, ua, 'valid');
  const remainingDays = Math.max(
    0,
    Math.ceil(
      (new Date(row.expire_date).getTime() - Date.now()) / 86_400_000,
    ),
  );
  return json({
    valid: true,
    reason: 'valid',
    credential_type: isTokenMode ? 'token' : 'license_key',
    license_key: row.license_key ?? null,
    token: row.token ?? null,
    plan: row.plan ?? null,
    remaining_days: remainingDays,
    used_count: row.used_count,
    max_usage: row.max_usage ?? null,
    expire_date: row.expire_date,
  });
});

function reasonMessage(reason: string, isToken = false): string {
  const noun = isToken ? 'Token' : '激活码';
  switch (reason) {
    case 'invalid':
      return `${noun}不存在或格式错误`;
    case 'expired':
      return `${noun}已过期`;
    case 'disabled':
      return isToken ? 'Token 已被吊销' : '激活码已被禁用';
    case 'over_usage':
      return '激活码使用次数已达上限';
    default:
      return '验证未通过';
  }
}
