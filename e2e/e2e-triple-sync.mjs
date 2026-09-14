/**
 * e2e/e2e-triple-sync.mjs — 三浏览器联合验证：Chromium × Firefox × Edge。
 *
 *   设备 A（Chromium, 9345）   设备 B（Firefox, 9346 桥）   设备 C（Edge, 9347）
 *     A seed → 三方登录同一空间，互相注入 E2EE 密钥
 *     A 建 A1 → B、C 同步拉到；B 建 B1 → A、C 拉到；C 建 C1 → A、B 拉到
 *     终态：三端各有且仅有 1 个 A1/B1/C1（计数 ===1）
 *     菜单：Firefox menu________ ↔ Chromium/Edge「书签菜单」文件夹 双向同步
 *     场景3：Edge 优雅重启（同 profile）→ 书签保留
 *
 * Edge 是 Chromium 系（根 id "0"/"1"/"2"/"3"，UA Edg/ → IS_FIREFOX=false），
 * 用 CHROME_BIN 指向 msedge 二进制走同一 CDP 启动路径。
 *
 * 环境变量：
 *   EMAIL / PASSWORD    Supabase 账号（必填）
 *   CHROME_BIN          A 端二进制（默认 /opt/browser/chrome）
 *   EDGE_BIN            C 端二进制（默认 /home/user/tools/msedge/opt/microsoft/msedge/msedge）
 *
 * 用法：
 *   EMAIL=xxx PASSWORD=yyy E2E_RESET=1 node e2e/e2e-triple-sync.mjs
 */
import { launchChromium } from './lib/launch.mjs';
import { waitForExtensionSw, connect, sleep } from './lib/cdp.mjs';
import { openPopup, loginIfNeeded, ensureSpace, clickSyncAndWait, createBookmark, getTree, flattenTree } from './lib/popup.mjs';
import { launchFirefox } from './lib/launchFirefox.mjs';
import { startBridgeServer, openBridgePage, bridgeCall, stopBridgeServer } from './lib/ffbridge.mjs';
import { sql } from './lib/supabase.mjs';
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
const EDGE_BIN = process.env.EDGE_BIN ?? '/home/user/tools/msedge/opt/microsoft/msedge/msedge';

// ── 清理：杀残留测试浏览器 + 删 profile ─────────────────────────────
try {
  execSync(`ps -eo pid,args | grep -E "e2e/.profiles|e2e/.ff-profiles" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true`);
} catch {}
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  let alive = 0;
  try { alive = Number(execSync(`ps -eo args | grep -E "e2e/.profiles|e2e/.ff-profiles" | grep -v grep | wc -l`).toString().trim()); } catch {}
  if (alive === 0) break;
}
rmSync(join(ROOT, 'e2e', '.profiles'), { recursive: true, force: true });
rmSync(join(ROOT, 'e2e', '.ff-profiles'), { recursive: true, force: true });

if (process.env.E2E_RESET === '1') {
  await sql('TRUNCATE bsync_op_log; TRUNCATE bsync_snapshots;');
  console.log('[tri] 已清空 bsync_op_log / bsync_snapshots');
}

// ── 启动三端 ──────────────────────────────────────────────────────
const A = launchChromium({ port: 9345 }); // Chromium（默认二进制）
const C = launchChromium({ port: 9347, chromeBin: EDGE_BIN }); // Edge
const [A_, C_] = await Promise.all([waitForExtensionSw(9345), waitForExtensionSw(9347)]);
const swA = await connect(A_.sw.webSocketDebuggerUrl);
await swA.send('Runtime.enable');
const swC = await connect(C_.sw.webSocketDebuggerUrl);
await swC.send('Runtime.enable');
console.log(`[tri] A(Chromium) ext=${A_.extId}  C(Edge) ext=${C_.extId}`);

const ff = await launchFirefox({ port: 9346, extraExtensions: [join(ROOT, 'e2e', 'test-bridge')] });
const { bidi } = ff;
await startBridgeServer();
const ctx = await openBridgePage(bidi);

// ── 登录三端 + 注入密钥 ────────────────────────────────────────────
const pageA = await openPopup(9345, A_.extId);
await loginIfNeeded(pageA, EMAIL, PASSWORD);
await ensureSpace(pageA, 'E2E 三端空间');
await clickSyncAndWait(pageA);
console.log('[tri] A(Chromium) 已就绪并首次同步（seed）');

const pageC = await openPopup(9347, C_.extId);
await loginIfNeeded(pageC, EMAIL, PASSWORD);
await ensureSpace(pageC, 'E2E 三端空间');

const aKey = await pageA.eval(`(async () => (await chrome.storage.local.get(['crdt.e2eeKey','crdt.e2eeSalt'])) )()`);
const cInject = await pageC.eval(`(async () => {
  const a = ${JSON.stringify(aKey.val ?? {})};
  await chrome.storage.local.set({ 'crdt.e2eeKey': a['crdt.e2eeKey'], 'crdt.e2eeSalt': a['crdt.e2eeSalt'] });
  return !!a['crdt.e2eeKey'];
})()`);
console.log('[tri] C(Edge) 注入密钥:', cInject.val);
if (!cInject.val) { console.error('FAIL: A 没有 E2EE 密钥'); process.exit(1); }
await clickSyncAndWait(pageC);
console.log('[tri] C(Edge) 首次同步完成');

const bInject = await bridgeCall(bidi, ctx, 'storage.set', {
  values: { 'crdt.e2eeKey': aKey.val?.['crdt.e2eeKey'], 'crdt.e2eeSalt': aKey.val?.['crdt.e2eeSalt'] },
});
const loginB = await bridgeCall(bidi, ctx, 'login', { email: EMAIL, password: PASSWORD });
console.log('[tri] B(Firefox) 密钥注入 + login:', bInject.ok && loginB.ok ? 'ok' : JSON.stringify({ bInject, loginB }));
if (!(bInject.ok && loginB.ok)) process.exit(1);
const syncB1 = await bridgeCall(bidi, ctx, 'sync', {});
console.log('[tri] B(Firefox) 首次 sync:', JSON.stringify(syncB1));
if (!syncB1.ok) process.exit(1);

const treeB = await bridgeCall(bidi, ctx, 'bookmarks.getTree', {});
const walkB = (nodes, out) => { for (const n of nodes) { if (n.title) out.push({ title: n.title, id: n.id, parentId: n.parentId }); if (n.children) walkB(n.children, out); } };
const flatB = [];
walkB(treeB.tree ?? [], flatB);

// ── A 建 A1 → B/C 同步拉到 ────────────────────────────────────────
const titleA = `A-Cr-${Date.now() % 100000}`;
await createBookmark(swA, { parentId: '2', title: titleA, url: 'https://e2e-a.example.com/' + Date.now() });
await sleep(8000);
await clickSyncAndWait(pageA);

await bridgeCall(bidi, ctx, 'sync', {});
const flatB1 = [];
walkB((await bridgeCall(bidi, ctx, 'bookmarks.getTree', {})).tree ?? [], flatB1);
const bHasA1 = flatB1.some((n) => n.title === titleA);
console.log('[tri] B 含 A1:', bHasA1);

await clickSyncAndWait(pageC);
const treeC = flattenTree(await getTree(swC));
const cHasA1 = treeC.some((n) => n.title === titleA);
console.log('[tri] C 含 A1:', cHasA1);
if (!bHasA1 || !cHasA1) { console.error('FAIL: A1 未同步到 B/C'); process.exit(1); }

// ── B 建 B1 → A/C 拉到 ────────────────────────────────────────────
const titleB = `B-FF-${Date.now() % 100000}`;
const createdB = await bridgeCall(bidi, ctx, 'bookmarks.create', {
  parentId: 'toolbar_____', title: titleB, url: 'https://e2e-b.example.com/' + Date.now(),
});
if (!createdB.ok) { console.error('FAIL: B 建书签失败', JSON.stringify(createdB)); process.exit(1); }
await sleep(8000);
await bridgeCall(bidi, ctx, 'sync', {});

await clickSyncAndWait(pageA);
const treeA1 = flattenTree(await getTree(swA));
const aHasB1 = treeA1.some((n) => n.title === titleB);
await clickSyncAndWait(pageC);
const treeC1 = flattenTree(await getTree(swC));
const cHasB1 = treeC1.some((n) => n.title === titleB);
console.log('[tri] A 含 B1:', aHasB1, ' C 含 B1:', cHasB1);
if (!aHasB1 || !cHasB1) { console.error('FAIL: B1 未同步到 A/C'); process.exit(1); }

// ── C 建 C1 → A/B 拉到 ────────────────────────────────────────────
const titleC = `C-Ed-${Date.now() % 100000}`;
await createBookmark(swC, { parentId: '2', title: titleC, url: 'https://e2e-c.example.com/' + Date.now() });
await sleep(8000);
await clickSyncAndWait(pageC);

await clickSyncAndWait(pageA);
const treeA2 = flattenTree(await getTree(swA));
const aHasC1 = treeA2.some((n) => n.title === titleC);
await bridgeCall(bidi, ctx, 'sync', {});
const flatB2 = [];
walkB((await bridgeCall(bidi, ctx, 'bookmarks.getTree', {})).tree ?? [], flatB2);
const bHasC1 = flatB2.some((n) => n.title === titleC);
console.log('[tri] A 含 C1:', aHasC1, ' B 含 C1:', bHasC1);
if (!aHasC1 || !bHasC1) { console.error('FAIL: C1 未同步到 A/B'); process.exit(1); }

// ── 终态三方收敛（三端 × 三书签 各恰 1）────────────────────────────
await clickSyncAndWait(pageC);
const treeA3 = flattenTree(await getTree(swA));
const treeC3 = flattenTree(await getTree(swC));
const flatB3 = [];
walkB((await bridgeCall(bidi, ctx, 'bookmarks.getTree', {})).tree ?? [], flatB3);
const count = (list, t) => list.filter((n) => n.title === t).length;
const titles = [titleA, titleB, titleC];
const all = (list) => titles.every((t) => count(list, t) === 1);
const converged = all(treeA3) && all(treeC3) && all(flatB3);
console.log('[tri] 三方收敛（A1/B1/C1 各端各恰 1）:', converged);
console.log('[tri] A 树:', treeA3.filter(n => n.title).map(n => n.title).join(','));
console.log('[tri] B 树:', flatB3.map(n => n.title).join(','));
console.log('[tri] C 树:', treeC3.filter(n => n.title).map(n => n.title).join(','));
if (!converged) { console.error('FAIL: 三方未收敛'); process.exit(1); }

// ── 菜单同步（Firefox menu________ ↔ Chromium/Edge「书签菜单」）────
const titleM1 = `M-FF-${Date.now() % 100000}`;
const m1 = await bridgeCall(bidi, ctx, 'bookmarks.create', {
  parentId: 'menu________', title: titleM1, url: 'https://e2e-menu-ff.example.com/' + Date.now(),
});
if (!m1.ok) { console.error('FAIL: B 菜单建书签失败'); process.exit(1); }
await sleep(8000);
await bridgeCall(bidi, ctx, 'sync', {});

await clickSyncAndWait(pageA);
await clickSyncAndWait(pageC);
const treeAM = flattenTree(await getTree(swA));
const treeCM = flattenTree(await getTree(swC));
const menuFolderA = treeAM.find((n) => n.title === '书签菜单');
const menuFolderC = treeCM.find((n) => n.title === '书签菜单');
console.log('[tri] A 菜单文件夹:', menuFolderA ? menuFolderA.id : '缺失', ' C 菜单文件夹:', menuFolderC ? menuFolderC.id : '缺失');
const aHasM1 = menuFolderA && count(treeAM, titleM1) === 1;
const cHasM1 = menuFolderC && count(treeCM, titleM1) === 1;
console.log('[tri] A 菜单含 M1:', aHasM1, ' C 菜单含 M1:', cHasM1);
if (!aHasM1 || !cHasM1) { console.error('FAIL: Firefox 菜单书签未同步到 A/C 菜单文件夹'); process.exit(1); }

// C(Edge) 在「书签菜单」建书签 → B 的 menu________ 出现
const titleM2 = `M-Ed-${Date.now() % 100000}`;
await createBookmark(swC, { parentId: menuFolderC.id, title: titleM2, url: 'https://e2e-menu-ed.example.com/' + Date.now() });
await sleep(8000);
await clickSyncAndWait(pageC);
await bridgeCall(bidi, ctx, 'sync', {});
const flatB4 = [];
walkB((await bridgeCall(bidi, ctx, 'bookmarks.getTree', {})).tree ?? [], flatB4);
const bHasM2 = count(flatB4, titleM2) === 1;
console.log('[tri] B 的 menu________ 含 M2:', bHasM2);
if (!bHasM2) { console.error('FAIL: Edge 菜单书签未同步到 Firefox 菜单'); process.exit(1); }

// ── 场景3：Edge 优雅重启（同 profile）→ 书签保留 ───────────────────
console.log('[tri] 场景3：优雅关闭 Edge 并同 profile 重启…');
const edgePid = C.pid;
const swC_before = C_.sw.id;
process.kill(edgePid, 'SIGTERM');
for (let i = 0; i < 30; i++) {
  await sleep(1000);
  let alive = 0;
  try { alive = Number(execSync(`ps -eo args | grep "e2e/.profiles/9347" | grep -v grep | wc -l`).toString().trim()); } catch {}
  if (alive === 0) break;
}
const C2 = launchChromium({ port: 9347, chromeBin: EDGE_BIN });
const C2_ = await waitForExtensionSw(9347);
console.log('[tri] Edge SW 重启:', swC_before !== C2_.sw.id ? 'true' : 'false');
const swC2 = await connect(C2_.sw.webSocketDebuggerUrl);
await swC2.send('Runtime.enable');
// onStartup 自动同步 + popup 手动兜底
await sleep(6000);
const pageC2 = await openPopup(9347, C2_.extId);
await clickSyncAndWait(pageC2);
const treeC2 = flattenTree(await getTree(swC2));
const c2Ok = titles.every((t) => count(treeC2, t) === 1) && count(treeC2, titleM1) === 1 && count(treeC2, titleM2) === 1;
console.log('[tri] Edge 冷重启后书签保留:', c2Ok, ' C 树:', treeC2.filter(n => n.title).map(n => n.title).join(','));
if (!c2Ok) { console.error('FAIL: Edge 冷重启后书签丢失'); process.exit(1); }

stopBridgeServer();
try {
  execSync(`ps -eo pid,args | grep "e2e/.ff-profiles" | grep -v grep | awk '{print $1}' | xargs -r kill 2>/dev/null || true`);
} catch {}
console.log('\n✅ e2e-triple-sync 通过：Chromium × Firefox × Edge 三方同步收敛（含菜单 + Edge 冷重启保留）');
process.exit(0);
