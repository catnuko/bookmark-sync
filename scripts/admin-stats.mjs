/**
 * 只读运营统计：登录 Supabase Auth（凭据取 .dev-creds.json，gitignored），
 * 调后台 admin_* RPC 输出用户数 / 付费 / 新增 / 设备分布 / 操作日志概况。
 * 与后台管理面板同一条链路（bsync_admins 身份），无写操作，不打印任何密钥。
 *
 * 用法：node scripts/admin-stats.mjs [--json]
 * 需要：仓库根目录有 .dev-creds.json（email + password）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 直连 supabase.co 在国内网络会被重置；Node fetch 不读 macOS 系统代理，
// 所以首次运行时检测系统代理，带 NODE_USE_ENV_PROXY 重启自己。
if (
  process.platform === 'darwin' &&
  !process.env.NODE_USE_ENV_PROXY &&
  !process.env.HTTPS_PROXY &&
  !process.env.HTTP_PROXY
) {
  const out = execFileSync('scutil', ['--proxy'], { encoding: 'utf8' });
  const host = out.match(/HTTPSProxy\s*:\s*(\S+)/)?.[1];
  const port = out.match(/HTTPSPort\s*:\s*(\d+)/)?.[1];
  if (host && port) {
    const { status } = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: '1',
          HTTPS_PROXY: `http://${host}:${port}`,
          HTTP_PROXY: `http://${host}:${port}`,
        },
      },
    );
    process.exit(status ?? 1);
  }
}

// 与 src/lib/supabase.ts 保持一致（publishable key，本就打包进扩展）
const BASE = 'https://cwtqnsbpcetvqopdkcou.supabase.co';
const ANON = 'sb_publishable_ezewylV3uHkEXOC6s-eJPg_svk8kI3H';

const asJson = process.argv.includes('--json');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function post(path, body, token) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    die(`HTTP ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const credsPath = join(ROOT, '.dev-creds.json');
let creds;
try {
  creds = JSON.parse(readFileSync(credsPath, 'utf8'));
} catch {
  die(`读取失败：${credsPath}（需要 email + password 字段）`);
}
if (!creds.email || !creds.password) die(`${credsPath} 缺 email / password 字段`);

const { access_token: token } = await post('/auth/v1/token?grant_type=password', {
  email: creds.email,
  password: creds.password,
});

const rpc = (name, params = {}) => post(`/rest/v1/rpc/${name}`, params, token);

const [whoami, overview, stats, userList] = await Promise.all([
  rpc('admin_whoami'),
  rpc('admin_overview'),
  rpc('admin_system_stats'),
  rpc('admin_list_users', { p_limit: 1, p_offset: 0 }),
]);

if (!whoami?.is_admin) {
  die(`${whoami?.email ?? '?'} 不是管理员（bsync_admins），无法查询`);
}

const result = {
  queried_at: new Date().toISOString(),
  total_users: overview.total_users,
  paid_users: overview.paid_users,
  paid_rate: overview.paid_rate,
  new_today: overview.new_today,
  new_7d: overview.new_7d,
  devices_total: overview.devices?.reduce((s, d) => s + d.n, 0) ?? 0,
  device_breakdown: overview.devices ?? [],
  oplog_rows: overview.oplog_rows,
  oplog_bytes: overview.oplog_bytes,
  top_users: (stats.top_users ?? []).slice(0, 5).map((u) => ({
    email: u.email,
    oplog_rows: u.oplog_rows,
    oplog_bytes: u.oplog_bytes,
  })),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  console.log(`查询时间：${result.queried_at}（账号 ${whoami.email}）`);
  console.log(
    `注册用户：${result.total_users}，付费：${result.paid_users}（${(result.paid_rate * 100).toFixed(1)}%）`,
  );
  console.log(`新增：今日 ${result.new_today}，近 7 天 ${result.new_7d}`);
  console.log(`设备总数：${result.devices_total}`);
  for (const d of result.device_breakdown) console.log(`  - ${d.name}: ${d.n}`);
  console.log(`操作日志：${result.oplog_rows} 行 / ${mb(result.oplog_bytes)}`);
  console.log('用量前 5：');
  for (const u of result.top_users)
    console.log(`  - ${u.email}: ${u.oplog_rows} 行 / ${mb(u.oplog_bytes)}`);
}
