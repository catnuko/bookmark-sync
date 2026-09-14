/**
 * e2e/e2e-two-device.mjs — 双浏览器双向同步（真实 Chromium）。
 *
 * 这是 reverseApply（远端 → 本机写回）+ 双向同步的端到端验证：
 *
 *   设备 A (port 9345)          服务器 (Supabase)          设备 B (port 9346)
 *      │  建书签 A1 ────────────► op_log ─────────────────► 同步拉到 A1
 *      │                                                    reverseApply → B 的 chrome 树出现 A1
 *      │  ◄───────────────────── op_log ◄────────────────── 建书签 B1
 *      │  同步拉到 B1
 *      │  reverseApply → A 的 chrome 树出现 B1
 *
 * E2EE：B 是新设备，无密钥时无法解密 A 的 op（这是产品设计——新设备需导入
 * 密钥）。脚本在 B 登录后把 A 的密钥写入 B 的 storage，模拟用户已完成导入。
 *
 * 环境变量：
 *   EMAIL / PASSWORD   Supabase 账号（必填）
 *   E2E_RESET=1        先清空该账号 bsync_op_log（测试账号专用，勿在生产用）
 *
 * 用法：
 *   EMAIL=xxx PASSWORD=yyy E2E_RESET=1 node e2e/e2e-two-device.mjs
 */
import { launchChromium } from './lib/launch.mjs';
import { waitForExtensionSw, connect, sleep } from './lib/cdp.mjs';
import { openPopup, loginIfNeeded, ensureSpace, clickSyncAndWait, createBookmark, getTree, flattenTree } from './lib/popup.mjs';
import { opCount, devices, sql } from './lib/supabase.mjs';
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

// 自清理：杀残留测试 Chromium + 清 profile。残留节点会干扰 reverseApply 的
// index 计算（chrome "Index out of bounds"），每次从干净起点验证。
// 注意：测试二进制可能是 /opt/browser/chrome（symlink），进程名是 chrome，
// 不能按名字匹配（会误杀环境浏览器）；用 e2e/.profiles 路径特征精确匹配。
try {
  execSync(`ps -eo pid,args | grep "e2e/.profiles" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true`);
} catch {}
// 轮询等待进程退出（fuse 文件在进程存续期间被占用，直接 rm 会 EBUSY）
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  let alive = 0;
  try { alive = Number(execSync(`ps -eo args | grep "e2e/.profiles" | grep -v grep | wc -l`).toString().trim()); } catch {}
  if (alive === 0) break;
}
rmSync(join(ROOT, 'e2e', '.profiles'), { recursive: true, force: true });

// 可选：清空测试账号的 op_log（干净起点，验证播种→同步→写回全链路）
if (process.env.E2E_RESET === '1') {
  await sql('TRUNCATE bsync_op_log;');
  console.log('[2dev] 已清空 bsync_op_log（E2E_RESET=1）');
}

// ── 启动两台浏览器 ──────────────────────────────────────────────
const A = launchChromium({ port: 9345 });
const B = launchChromium({ port: 9346 });
const [A_, B_] = await Promise.all([waitForExtensionSw(9345), waitForExtensionSw(9346)]);
console.log(`[2dev] A ext=${A_.extId}  B ext=${B_.extId}`);

const swA = await connect(A_.sw.webSocketDebuggerUrl);
await swA.send('Runtime.enable');
const swB = await connect(B_.sw.webSocketDebuggerUrl);
await swB.send('Runtime.enable');

// ── A：登录 → 确保空间 → 同步 ─────────────────────────────────────
const pageA = await openPopup(9345, A_.extId);
await loginIfNeeded(pageA, EMAIL, PASSWORD);
await ensureSpace(pageA, 'E2E 双向空间');
console.log('[2dev] A 已就绪（默认空间）');
await clickSyncAndWait(pageA);
console.log('[2dev] A 首次同步完成（云端空 → 本机树播种）');

// ── B：登录 → 注入 A 的 E2EE 密钥（模拟新设备已导入）→ 同步 ───────
const pageB = await openPopup(9346, B_.extId);
await loginIfNeeded(pageB, EMAIL, PASSWORD);
await ensureSpace(pageB, 'E2E 双向空间');
// 把 A 的密钥/盐复制到 B（真实产品走「导入密钥」UI；测试直接注入省时）
const aKey = await pageA.eval(`(async () => (await chrome.storage.local.get(['crdt.e2eeKey','crdt.e2eeSalt'])) )()`);
const bInject = await pageB.eval(`(async () => {
  const a = ${JSON.stringify(aKey.val ?? {})};
  await chrome.storage.local.set({ 'crdt.e2eeKey': a['crdt.e2eeKey'], 'crdt.e2eeSalt': a['crdt.e2eeSalt'] });
  return !!a['crdt.e2eeKey'];
})()`);
console.log('[2dev] B 已注入 A 的密钥:', bInject.val);
if (!bInject.val) {
  console.error('FAIL: A 没有 E2EE 密钥（A 未启用加密？）');
  process.exit(1);
}
await clickSyncAndWait(pageB);
console.log('[2dev] B 首次同步完成（拉到 A 的播种 op）');

// 捕获 SW 异常，便于定位 reverseApply 失败点
swB.ws.addEventListener('message', (ev) => {
  try {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      console.log('[2dev][SW-B 异常]', m.params.exceptionDetails?.exception?.description?.slice(0, 300) ?? m.params.exceptionDetails?.text);
    }
  } catch {}
});

// ── A 建书签 A1 → B 拉到并 reverseApply ─────────────────────────
const titleA = `A-设备-${Date.now() % 100000}`;
const a1 = await createBookmark(swA, { parentId: '2', title: titleA, url: 'https://e2e-a.example.com/' + Date.now() });
console.log('[2dev] A 创建:', a1.id, titleA);
await sleep(8000);

const bSync = await clickSyncAndWait(pageB);
console.log('[2dev] B 同步状态:', bSync.status);
const bDiag = await swB.eval(`chrome.storage.local.get(['lastSyncError','lastRaError']).then(o => JSON.stringify(o))`);
if (bDiag.val && bDiag.val !== '{}') console.log('[2dev][诊断] B storage:', bDiag.val);
const treeB = flattenTree(await getTree(swB));
const bHasA1 = treeB.some((n) => n.title === titleA);
console.log('[2dev] B 的 chrome 树含 A1:', bHasA1, ' 树节点:', treeB.filter(n => n.title).map(n => n.title).join(','));
if (!bHasA1) {
  // 诊断：读 B 的持久化错误（runSync catch / reverseApply create catch）
  const diag = await swB.eval(`chrome.storage.local.get(['lastSyncError','lastRaError']).then(o => JSON.stringify(o))`);
  console.error('[2dev][诊断] B storage:', diag.val);
  console.error('FAIL: 远端写回本机（reverseApply）未生效——B 看不到 A 的书签');
  process.exit(1);
}

// ── B 建书签 B1 → A 拉到并 reverseApply ─────────────────────────
const titleB = `B-设备-${Date.now() % 100000}`;
const b1 = await createBookmark(swB, { parentId: '2', title: titleB, url: 'https://e2e-b.example.com/' + Date.now() });
console.log('[2dev] B 创建:', b1.id, titleB);
await sleep(8000);

await clickSyncAndWait(pageA);
const treeA = flattenTree(await getTree(swA));
const aHasB1 = treeA.some((n) => n.title === titleB);
console.log('[2dev] A 的 chrome 树含 B1:', aHasB1);
if (!aHasB1) {
  const diag = await swA.eval(`chrome.storage.local.get(['lastSyncError','lastRaError']).then(o => JSON.stringify(o))`);
  console.error('[2dev][诊断] A storage:', diag.val);
  console.error('FAIL: 反向写回未生效——A 看不到 B 的书签');
  process.exit(1);
}

// 终态前再各同步一次，收敛判定用最新树
await clickSyncAndWait(pageB);
const treeB2 = flattenTree(await getTree(swB));
await clickSyncAndWait(pageA);
const treeA2 = flattenTree(await getTree(swA));

// ── 终态断言：两端都收敛到 {A1, B1} 且无重复 ────────────────────
// 计数断言（===1）是「reverseApply 重复建书签」bug 的回归检查：
// 冷启动/回收后 idMap 未恢复时，reverseApply 会把已有书签当缺失重复创建。
const count = (list, t) => list.filter((n) => n.title === t).length;
const a1InA = count(treeA2, titleA), b1InA = count(treeA2, titleB);
const a1InB = count(treeB2, titleA), b1InB = count(treeB2, titleB);
const converged = a1InA === 1 && b1InA === 1 && a1InB === 1 && b1InB === 1;
console.log('[2dev] 双向收敛（两端各有且仅有 1 个 A1/B1）:', converged, `A侧=[A1×${a1InA},B1×${b1InA}] B侧=[A1×${a1InB},B1×${b1InB}]`);
console.log('[2dev] A 树:', treeA2.filter(n => n.title).map(n => n.title).join(','));
console.log('[2dev] B 树:', treeB2.filter(n => n.title).map(n => n.title).join(','));
console.log('[2dev] op_log 总数:', await opCount(), ' 设备数:', await devices());

if (!converged) {
  console.error('FAIL: 双端未收敛或有重复书签');
  process.exit(1);
}

// ── 场景 3：优雅关闭浏览器 → 同 profile 重启（SW 冷重启）后书签保留 ──
// MV3 SW 30s 无事件即被回收；浏览器重启后内存 CRDT 为空（仅固定根 = isBare），
// runSync 必须先全量重放（pullFrom(0)）再 reverseApply，否则会把本机
// 书签树当「已删除」清空。onStartup 触发自动 sync，是架构级回归测试。
// 注意：必须 SIGTERM 优雅关闭（kill -9 会损坏 profile 扩展状态 →
// ERR_BLOCKED_BY_CLIENT）；chrome.runtime.reload() 在本 Chromium 146
// 构建中 reload 后 SW 无法被事件唤醒，故改为整进程优雅重启。
console.log('[2dev] 场景3：优雅关闭浏览器并同 profile 重启（SW 冷重启）…');
const swB_before = B_.sw.id;
// 1) SIGTERM 优雅关闭 B（保留 profile：E2EE 密钥、afterId 水位、书签树）
try { process.kill(B.pid, 'SIGTERM'); } catch {}
// 2) 等待 CDP 端口关闭（进程退出）
{
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${B.port}/json/list`);
      await sleep(500);
    } catch { break; }
  }
}
// 3) 等进程彻底退出（fuse 文件释放，避免重启时 EBUSY / SingletonLock 冲突）
let bAlive = 1;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  try {
    bAlive = Number(execSync(`ps -eo args | grep "e2e/.profiles/${B.port}" | grep -v grep | wc -l`).toString().trim());
  } catch {}
  if (bAlive === 0) break;
}
if (bAlive > 0) {
  console.error(`FAIL: B (port ${B.port}) 未在预期时间内退出，无法同 profile 重启`);
  process.exit(1);
}
// 4) 同 profile 重启（launch.mjs 按 port 定位 profile；onStartup 自动 sync）
launchChromium({ port: B.port });
const { extId: extB3, sw: swB3 } = await waitForExtensionSw(B.port, 45000);
const swRestarted = swB3.id !== swB_before;
console.log('[2dev] SW 重启:', swRestarted, `（${swB_before.slice(0, 8)} → ${swB3.id.slice(0, 8)}）`);

// 5) 打开 popup 再手动同步一次（onStartup 的 sync 是异步的，以 lastSyncAt 变化为准）
const pageB3 = await openPopup(B.port, extB3);
await clickSyncAndWait(pageB3);
const swB3c = await connect(swB3.webSocketDebuggerUrl);
await swB3c.send('Runtime.enable');
const treeB3 = flattenTree(await getTree(swB3c));
const a1Cnt = count(treeB3, titleA), b1Cnt = count(treeB3, titleB);
const keepA1 = a1Cnt === 1, keepB1 = b1Cnt === 1;
console.log('[2dev] 冷重启后 B 树:', treeB3.filter(n => n.title).map(n => n.title).join(','));
console.log('[2dev] 冷重启后保留 A1/B1:', keepA1, keepB1, `（A1×${a1Cnt}, B1×${b1Cnt}）`);
if (!(keepA1 && keepB1)) {
  const diag = await swB3c.eval(`chrome.storage.local.get(['lastSyncError','lastRaError','crdt.afterId']).then(o => JSON.stringify(o))`);
  console.error('[2dev][诊断] B storage:', diag.val);
  console.error('FAIL: SW 冷重启后书签丢失（冷启动全量重放保护未生效）');
  process.exit(1);
}

console.log('\n✅ e2e-two-device 全部通过：远端写回 + 双向同步 + SW 冷重启保留均正常');
process.exit(0);
