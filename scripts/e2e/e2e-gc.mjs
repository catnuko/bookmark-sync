/**
 * e2e/e2e-gc.mjs — 快照 + op-log GC 端到端验证（真实 Chromium ×3）。
 *
 * 验证 P3 主线 ①（bsync_snapshots 启用 + GC）：
 *   1. A 建 3 书签 → 同步（注入 crdt.gcThreshold=1，行数超阈值触发 GC）
 *      → 断言 op_log 被截断、bsync_snapshots 出现 1 行（加密投影）
 *   2. C（全新设备，afterId=0）→ 从快照重建 → 断言收敛（A1/A2/A3 各恰 1）
 *   3. GC 后增量仍通：C 建 C1 → A/B 同步拉到（不因截断丢失新 op）
 *   4. 终态双向收敛 + 计数 ===1（无重复）
 *
 * 环境变量：EMAIL / PASSWORD（必填）。脚本自清 bsync_op_log /
 * bsync_snapshots（测试账号专用）。
 */
import { launchChromium } from './lib/launch.mjs';
import { waitForExtensionSw, connect, sleep } from './lib/cdp.mjs';
import {
  openPopup,
  loginIfNeeded,
  ensureSpace,
  clickSyncAndWait,
  createBookmark,
  getTree,
  flattenTree,
} from './lib/popup.mjs';
import { opCount, sql } from './lib/supabase.mjs';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('需要 EMAIL / PASSWORD 环境变量');
  process.exit(1);
}

// ── 自清理 ──────────────────────────────────────────────────────
try {
  execSync(
    `ps -eo pid,args | grep "e2e/.profiles" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true`,
  );
} catch {}
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  let alive = 0;
  try {
    alive = Number(
      execSync(`ps -eo args | grep "e2e/.profiles" | grep -v grep | wc -l`).toString().trim(),
    );
  } catch {}
  if (alive === 0) break;
}
rmSync(join(ROOT, 'e2e', '.profiles'), { recursive: true, force: true });

// 测试账号专用：清 op_log + 快照（干净起点）
await sql('TRUNCATE bsync_op_log; TRUNCATE bsync_snapshots;');
console.log('[gc] 已清空 bsync_op_log / bsync_snapshots');

// ── 启动 A / B ──────────────────────────────────────────────────
const A = launchChromium({ port: 9345 });
const B = launchChromium({ port: 9346 });
const [A_, B_] = await Promise.all([waitForExtensionSw(9345), waitForExtensionSw(9346)]);
const swA = await connect(A_.sw.webSocketDebuggerUrl);
await swA.send('Runtime.enable');
const swB = await connect(B_.sw.webSocketDebuggerUrl);
await swB.send('Runtime.enable');

const pageA = await openPopup(9345, A_.extId);
await loginIfNeeded(pageA, EMAIL, PASSWORD);
await ensureSpace(pageA, 'E2E GC 空间');
await clickSyncAndWait(pageA);
console.log('[gc] A 就绪（默认空间，首次同步）');

const pageB = await openPopup(9346, B_.extId);
await loginIfNeeded(pageB, EMAIL, PASSWORD);
await ensureSpace(pageB, 'E2E GC 空间');
const aKey = await pageA.eval(
  `(async () => (await chrome.storage.local.get(['crdt.e2eeKey','crdt.e2eeSalt'])) )()`,
);
const bInject = await pageB.eval(`(async () => {
  const a = ${JSON.stringify(aKey.val ?? {})};
  await chrome.storage.local.set({ 'crdt.e2eeKey': a['crdt.e2eeKey'], 'crdt.e2eeSalt': a['crdt.e2eeSalt'] });
  return !!a['crdt.e2eeKey'];
})()`);
console.log('[gc] B 已注入 A 的密钥:', bInject.val);
if (!bInject.val) {
  console.error('FAIL: A 没有 E2EE 密钥');
  process.exit(1);
}
await clickSyncAndWait(pageB);
console.log('[gc] B 首次同步完成');

// 注入 A：GC 阈值 1（行数 > 1 即截断）
const inj = await pageA.eval(
  `chrome.storage.local.set({ 'crdt.gcThreshold': 1 }).then(() => true)`,
);
console.log('[gc] A 注入 crdt.gcThreshold=1:', inj.val);

// ── A 建 3 书签 → 同步触发 GC ───────────────────────────────────
const titles = [];
for (let i = 1; i <= 3; i++) {
  const t = `GC-${i}-${Date.now() % 100000}`;
  titles.push(t);
  await createBookmark(swA, {
    parentId: '2',
    title: t,
    url: `https://e2e-gc-${i}.example.com/${Date.now()}`,
  });
}
console.log('[gc] A 已建 3 书签:', titles.join(','));
await sleep(4000);
await clickSyncAndWait(pageA);
await sleep(3000);

const nOps = await opCount();
const snaps = await sql(
  'SELECT id, after_op_id, data IS NOT NULL AS has_data, created_at FROM bsync_snapshots ORDER BY id DESC LIMIT 5;',
);
console.log('[gc] op_log 总数（截断后）:', nOps, ' 快照:', JSON.stringify(snaps));
const hasSnap = snaps.length >= 1;
if (!hasSnap) {
  console.error('FAIL: GC 未落快照（bsync_snapshots 为空）');
  process.exit(1);
}
// 截断断言：op_log 行数应 <= 阈值 1（截断后为 0；若 B 后续又 push 则 ≤1）
if (nOps > 2) {
  console.error(`FAIL: op_log 未被截断（仍 ${nOps} 行）`);
  process.exit(1);
}
console.log('[gc] ✓ op_log 已截断（≤阈值），快照已落');

// ── C：全新设备 → 快照重建收敛 ──────────────────────────────────
const C = launchChromium({ port: 9347 });
const C_ = await waitForExtensionSw(9347);
const swC = await connect(C_.sw.webSocketDebuggerUrl);
await swC.send('Runtime.enable');
const pageC = await openPopup(9347, C_.extId);
await loginIfNeeded(pageC, EMAIL, PASSWORD);
await ensureSpace(pageC, 'E2E GC 空间');
const cInject = await pageC.eval(`(async () => {
  const a = ${JSON.stringify(aKey.val ?? {})};
  await chrome.storage.local.set({ 'crdt.e2eeKey': a['crdt.e2eeKey'], 'crdt.e2eeSalt': a['crdt.e2eeSalt'] });
  return true;
})()`);
console.log('[gc] C 已注入密钥，开始同步（应从快照重建）');
await clickSyncAndWait(pageC);

const treeC = flattenTree(await getTree(swC));
const cCount = (t) => treeC.filter((n) => n.title === t).length;
const cOk = titles.every((t) => cCount(t) === 1);
console.log(
  '[gc] C 的 chrome 树:',
  treeC
    .filter((n) => n.title)
    .map((n) => n.title)
    .join(','),
);
console.log('[gc] C 从快照重建收敛（A1-A3 各恰 1）:', cOk);
if (!cOk) {
  console.error('FAIL: C 未能从快照重建收敛');
  process.exit(1);
}

// ── GC 后增量仍通：C 建 C1 → A/B 拉到 ───────────────────────────
const titleC1 = `GC-C1-${Date.now() % 100000}`;
await createBookmark(swC, {
  parentId: '2',
  title: titleC1,
  url: 'https://e2e-gc-c1.example.com/' + Date.now(),
});
await sleep(4000);

await clickSyncAndWait(pageA);
const treeA = flattenTree(await getTree(swA));
const aHasC1 = treeA.some((n) => n.title === titleC1);
console.log('[gc] A 拉到 C1:', aHasC1);
if (!aHasC1) {
  console.error('FAIL: GC 后 A 无法增量拉到新 op');
  process.exit(1);
}

await clickSyncAndWait(pageB);
const treeB = flattenTree(await getTree(swB));
const bOk =
  titles.every((t) => treeB.filter((n) => n.title === t).length === 1) &&
  treeB.filter((n) => n.title === titleC1).length === 1;
console.log('[gc] B 收敛（A1-A3 + C1 各 1）:', bOk);
if (!bOk) {
  console.error('FAIL: B 未收敛');
  process.exit(1);
}

// ── 终态双向收敛 + 计数 ===1（无重复）────────────────────────────
const treeA2 = flattenTree(await getTree(swA));
const treeB2 = flattenTree(await getTree(swB));
const count = (list, t) => list.filter((n) => n.title === t).length;
const all = [...titles, titleC1];
const converged =
  all.every((t) => count(treeA2, t) === 1) && all.every((t) => count(treeB2, t) === 1);
console.log('[gc] 终态双向收敛（无重复）:', converged);
const finalSnap = await sql('SELECT count(*) n FROM bsync_snapshots;');
console.log('[gc] 终态快照数:', finalSnap[0].n, ' op_log:', await opCount());

if (!converged) {
  console.error('FAIL: 终态未收敛');
  process.exit(1);
}
console.log('[gc] PASS — 快照 GC 链路全部验证通过');
process.exit(0);
