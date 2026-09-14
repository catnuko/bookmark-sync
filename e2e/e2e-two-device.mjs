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

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('需要 EMAIL / PASSWORD 环境变量');
  process.exit(1);
}

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
const treeB = flattenTree(await getTree(swB));
const bHasA1 = treeB.some((n) => n.title === titleA);
console.log('[2dev] B 的 chrome 树含 A1:', bHasA1, ' 树节点:', treeB.filter(n => n.title).map(n => n.title).join(','));
if (!bHasA1) {
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
  console.error('FAIL: 反向写回未生效——A 看不到 B 的书签');
  process.exit(1);
}

// ── 终态断言：两端都收敛到 {A1, B1} ─────────────────────────────
const bothHaveBoth =
  treeA.some((n) => n.title === titleA) && treeA.some((n) => n.title === titleB) &&
  treeB.some((n) => n.title === titleA) && treeB.some((n) => n.title === titleB);
console.log('[2dev] 双向收敛（两端都有 A1+B1）:', bothHaveBoth);
console.log('[2dev] op_log 总数:', await opCount(), ' 设备数:', await devices());

if (!bothHaveBoth) {
  console.error('FAIL: 双端未收敛');
  process.exit(1);
}
console.log('\n✅ e2e-two-device 全部通过：远端写回（reverseApply）+ 双向同步均正常');
process.exit(0);
