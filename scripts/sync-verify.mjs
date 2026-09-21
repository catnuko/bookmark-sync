// 同步协议端到端验证（模拟 A/B/C 三台设备，同一 Supabase 账号）
// 场景：三端初始 {C1, C2, A} → A 删除 A → B 新增 N → C 同步
// 期望收敛到 {C1, C2, N}
//
// 用法：node scripts/sync-verify.mjs [email] [password]
// 未传则自动注册一个临时账号（需项目关闭邮箱验证，否则 signIn 会失败）。
import { createClient } from '@supabase/supabase-js';

const URL = 'https://cwtqnsbpcetvqopdkcou.supabase.co';
const ANON = 'sb_publishable_ezewylV3uHkEXOC6s-eJPg_svk8kI3H';

const [emailArg, passArg] = process.argv.slice(2);
const email = emailArg ?? `sync-verify-${Date.now()}@example.com`;
const password = passArg ?? 'SyncTest2026!';

const supabase = createClient(URL, ANON);

// ---------- 客户端逻辑（与 src/sync.js 保持一致） ----------

/** 设备同步一次：拉取 → 并集合并 + 墓碑清理 → 推送 */
async function deviceSync(device, localTree, localTombstones) {
  // 1. 拉取
  const { data: pull, error: pullErr } = await supabase.rpc('bsync_snapshot_pull');
  if (pullErr) throw new Error(`[${device}] pull failed: ${pullErr.message}`);
  const serverBm = pull?.bookmarks ?? [];
  const serverTomb = pull?.tombstones ?? [];

  // 2. 应用（与 applySnapshot 相同语义：本地独有保留，墓碑删除，服务端缺失则补建）
  const tombstoneSet = new Set([...serverTomb, ...localTombstones]);
  const localUrls = new Set(localTree.map((b) => b.url));
  const merged = [
    ...localTree.filter((b) => !tombstoneSet.has(b.url)), // 本地未被删除的
    ...serverBm.filter((b) => !tombstoneSet.has(b.url) && !localUrls.has(b.url)), // 服务端新增的
  ];

  // 3. 推送
  const { data: push, error: pushErr } = await supabase.rpc('bsync_snapshot_push', {
    p_data: merged.map(({ url, title, folder }) => ({ url, title, folder })),
    p_tombstones: localTombstones,
    p_device: device,
  });
  if (pushErr) throw new Error(`[${device}] push failed: ${pushErr.message}`);
  return { merged, push };
}

/** 读取服务端当前快照 URL 集合 */
async function serverState() {
  const { data, error } = await supabase.rpc('bsync_snapshot_pull');
  if (error) throw new Error(`pull failed: ${error.message}`);
  return {
    urls: new Set((data?.bookmarks ?? []).map((b) => b.url)),
    tombstones: new Set(data?.tombstones ?? []),
  };
}

const fmt = (s) => [...s].sort().join(',');

// ---------- 主流程 ----------

let attempts = 0;
let session = null;
// 登录：先试 signIn（复用已有账号）；失败则 signUp 再 signIn
while (!session && attempts < 3) {
  const { data, error } =
    attempts === 0
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
  if (data?.session) session = data.session;
  else if (error) console.warn(`attempt ${attempts}: ${error.message}`);
  attempts++;
  if (!session && attempts === 2) {
    const r = await supabase.auth.signUp({ email, password });
    if (r.data?.session) session = r.data.session;
    else console.warn(`signUp: ${r.error?.message ?? 'no session (email confirmation enabled?)'}`);
  }
  if (session) break;
}

if (!session) {
  console.error('FAIL: 无法建立会话（可能开启了邮箱验证，或账号密码错误）');
  process.exit(1);
}
console.log(`账号: ${email}`);

const initial = [
  { url: 'https://c1.example.com', title: 'C1', folder: 'BAR' },
  { url: 'https://c2.example.com', title: 'C2', folder: 'BAR' },
  { url: 'https://a.example.com', title: 'A', folder: 'BAR' },
];
const c1c2n = [
  { url: 'https://c1.example.com', title: 'C1', folder: 'BAR' },
  { url: 'https://c2.example.com', title: 'C2', folder: 'BAR' },
  { url: 'https://n.example.com', title: 'N', folder: 'BAR' },
];

// 1. 设备 A 首次推送初始状态 {C1, C2, A}
await deviceSync('A', initial, []);
let st = await serverState();
console.log(`[1] A 初始推送: server={${fmt(st.urls)}} tomb={${fmt(st.tombstones)}}`);
if (fmt(st.urls) !== 'c1,c2' && st.urls.size !== 3) {
  // 仅提示，不阻断（历史快照可能残留）
  console.log(`    (server 已有历史数据 ${fmt(st.urls)})`);
}

// 2. 设备 A 删除 A → 推送 {C1, C2} + 墓碑[A]
await deviceSync('A', initial.slice(0, 2), ['https://a.example.com']);
st = await serverState();
console.log(`[2] A 删除 A:    server={${fmt(st.urls)}} tomb={${fmt(st.tombstones)}}`);
if (fmt(st.urls) !== 'c1,c2' || fmt(st.tombstones) !== 'https://a.example.com') {
  console.error(`FAIL [2]: 期望 server={c1,c2} tomb={https://a.example.com}`);
  process.exit(1);
}

// 3. 设备 B 本地新增 N（B 本地还有 A）→ 同步后应删除 A 并保留 N
const bLocal = [...initial, { url: 'https://n.example.com', title: 'N', folder: 'BAR' }];
const { merged: bMerged } = await deviceSync('B', bLocal, []);
console.log(`[3] B 新增 N:    B本地收敛={${fmt(bMerged.map((b) => b.url))}}`);
st = await serverState();
console.log(`    server={${fmt(st.urls)}} tomb={${fmt(st.tombstones)}}`);
if (fmt(st.urls) !== 'c1,c2,https://n.example.com') {
  console.error(`FAIL [3]: 期望 server={c1,c2,N}`);
  process.exit(1);
}

// 4. 设备 C 从初始状态同步 → 应收敛到 {C1, C2, N}
const { merged: cMerged } = await deviceSync('C', initial, []);
console.log(`[4] C 同步:     C本地收敛={${fmt(cMerged.map((b) => b.url))}}`);
st = await serverState();
console.log(`    server={${fmt(st.urls)}} tomb={${fmt(st.tombstones)}}`);
if (fmt(cMerged.map((b) => b.url)) !== 'c1,c2,https://n.example.com') {
  console.error(`FAIL [4]: C 未收敛到 {C1,C2,N}`);
  process.exit(1);
}

// 5.（附加）原删除设备 A 重新添加 A → 重加获胜
await deviceSync(
  'A',
  c1c2n.concat([{ url: 'https://a.example.com', title: 'A', folder: 'BAR' }]),
  [],
);
st = await serverState();
console.log(`[5] A 重加 A:   server={${fmt(st.urls)}} tomb={${fmt(st.tombstones)}}`);
if (!st.urls.has('https://a.example.com')) {
  console.error(`FAIL [5]: 原删除设备重加应获胜`);
  process.exit(1);
}

console.log('\nPASS: 同步协议收敛验证通过 → 最终 {C1, C2, N}');
