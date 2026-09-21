/**
 * e2e/lib/cloud.mjs — 云端（Supabase）状态查询与测试数据复位。
 *
 * 走**本地 supabase CLI**（`supabase db query --linked`，走 Management API、走已链接的
 * 项目、无需 Docker / 无需 DB 密码）——这是本项目既有的远端运维口径，不要另起
 * pg 驱动 / psql / 隧道。`--output-format json` 拿到可直接 JSON.parse 的结果。
 *
 * 这里只做两类事：
 *   1. **只读查询**（断言用）：盐、op 数量、密文结构；
 *   2. **显式复位**（只有 `run.mjs reset` / `--fresh` 才调用）：镜像
 *      `admin_reset_user_data` 的删除顺序，但不要求管理员身份 —— CLI 走的是
 *      privileged 连接，而测试账号本身不是管理员（那条 RPC 第一行就 assert_bsync_admin）。
 *      产品侧入口仍是后台管理页的那条 RPC，这里只是为了在本地一键回到干净起点。
 */
import { execFileSync } from 'node:child_process';
import { ROOT } from './env.mjs';
import { sleep } from './cdp.mjs';

function cli(args, { timeoutMs = 60_000 } = {}) {
  try {
    return execFileSync('supabase', ['--yes', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 24,
      timeout: timeoutMs,
    });
  } catch (e) {
    // CLI 失败时把错误 JSON 写在 **stdout**（含 PG 原始报错），stderr 只有一行
    // "Initialising login role..."。不解析出来的话，报错信息会退化成一堆无用的
    // "Command failed"，排障时完全看不出是 SQL 写错了还是权限不够。
    const stdout = String(e.stdout ?? '');
    const stderr = String(e.stderr ?? '').trim();
    let detail = '';
    try {
      const j = JSON.parse(stdout.trim().split('\n').find((l) => l.trim().startsWith('{')) ?? '{}');
      detail = j?.error?.message ?? j?.message ?? '';
    } catch {
      detail = stdout.trim().slice(0, 300);
    }
    throw new Error(`supabase ${args.slice(0, 4).join(' ')} 失败: ${detail || stderr || e.message}`);
  }
}

export function cliAvailable() {
  try {
    execFileSync('supabase', ['--version'], { encoding: 'utf8', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** 执行 SQL，返回行数组（JSON）。 */
export function sql(query) {
  const out = cli(['db', 'query', '--linked', '--output-format', 'json', query]);
  const start = out.search(/[[{]/);
  if (start < 0) throw new Error(`无法解析 SQL 输出:\n${out.slice(0, 400)}`);
  return JSON.parse(out.slice(start));
}

/** 执行 SQL 但不解析返回（用于 DO 块等无结果语句）。 */
export function exec(query) {
  return cli(['db', 'query', '--linked', query]);
}

/** 当前账号的 profile 摘要（邮箱 / 档位 / 盐 / 用量）。无 profile 时返回 null。 */
export function profile(userId = null) {
  const where = userId ? `where p.user_id = '${userId}'` : '';
  const rows = sql(
    `select p.user_id, p.plan, p.e2ee_salt, p.used_count, p.used_bytes,
            (select u.email from auth.users u where u.id = p.user_id) as email
       from public.bsync_profiles p ${where} order by p.created_at limit 5`,
  );
  return rows[0] ?? null;
}

/** op_log 统计：总数 / 未加密信封数 / 明文泄漏可疑数（按 marker 探测）。 */
export function opStats(marker = 'bsync-e2e-marker') {
  const rows = sql(
    `select count(*)::int as ops,
            count(*) filter (where op->>'iv' is null or op->>'ciphertext' is null)::int as not_enveloped,
            count(*) filter (where position('${marker}' in op::text) > 0)::int as leaks
       from public.bsync_op_log`,
  );
  return rows[0] ?? { ops: 0, not_enveloped: 0, leaks: 0 };
}

export function spaces() {
  return sql(
    `select id, name, is_default, (select count(*)::int from public.bsync_devices d where d.space_id = s.id) as devices
       from public.bsync_spaces s order by created_at limit 20`,
  );
}

export function opCount() {
  return sql('select count(*)::int as n from public.bsync_op_log')[0]?.n ?? 0;
}

/**
 * 复位测试账号的云端数据（快照 → op_log → 设备 → 空间 → profile 盐/用量清零）。
 * 与 `admin_reset_user_data` 等价，只是不需要管理员身份。**破坏性操作**，只在显式
 * 要求时调用。
 */
export function resetUser(userId) {
  exec(`do $$
  declare uid uuid := '${userId}';
  begin
    delete from public.bsync_snapshots s using public.bsync_spaces sp
     where s.space_id = sp.id and sp.owner_id = uid;
    delete from public.bsync_op_log o using public.bsync_spaces sp
     where o.space_id = sp.id and sp.owner_id = uid;
    delete from public.bsync_devices d using public.bsync_spaces sp
     where d.space_id = sp.id and sp.owner_id = uid;
    delete from public.bsync_spaces where owner_id = uid;
    update public.bsync_profiles
       set e2ee_salt = null, used_count = 0, used_bytes = 0
     where user_id = uid;
  end $$;`);
}

/** 轮询云端直到 pred 为真（盐是设备1设口令时上传的，有几百毫秒延迟）。 */
export async function waitCloud(pred, { timeoutMs = 15_000, intervalMs = 1_500 } = {}) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await pred();
    if (last) return last;
    await sleep(intervalMs);
  }
  return null;
}
