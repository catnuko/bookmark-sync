/**
 * e2e/e2e-ff-sync.mjs — P1 验收：Chromium × Firefox 跨浏览器双向同步。
 *
 *   设备 A（Chromium, port 9345）     服务器 (Supabase)      设备 B（Firefox, port 9346）
 *     A 登录 + 建书签 A1 ───────────► op_log ─────────────► B 登录，sync 拉到 A1
 *                                                          reverseApply → B 树出现 A1
 *     ◄──────────────────────────── op_log ◄────────────── B 建书签 B1，sync 推送
 *     A sync 拉到 B1，reverseApply → A 树出现 B1
 *
 * 终态断言：A、B 两端各有且仅有 1 个 A1 与 1 个 B1（计数 ===1 为重复回环回归），
 *           op_log == 2（仅 A1 create + B1 create）。
 *
 * E2EE：B（新设备）无 A 的密钥，脚本把 A 的 crdt.e2eeKey/Salt 写入 B 的 storage
 *       （模拟产品「导入密钥」UI，与 e2e-two-device 相同约定）。
 *
 * 环境变量：
 *   EMAIL / PASSWORD   Supabase 账号（必填）
 *   E2E_RESET=1        先清空该账号 bsync_op_log
 *
 * 用法：
 *   EMAIL=xxx PASSWORD=yyy E2E_RESET=1 node e2e/e2e-ff-sync.mjs
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
import { launchFirefox } from './lib/launchFirefox.mjs';
import {
  startBridgeServer,
  openBridgePage,
  bridgeCall,
  stopBridgeServer,
} from './lib/ffbridge.mjs';
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

// ── 清理：杀残留测试浏览器 + 删 profile ─────────────────────────────
// 注意：grep 只能匹配 profile 路径特征（不能匹配脚本名，会误杀自身）。
try {
  execSync(
    `ps -eo pid,args | grep -E "e2e/.profiles|e2e/.ff-profiles" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true`,
  );
} catch {}
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  let alive = 0;
  try {
    alive = Number(
      execSync(`ps -eo args | grep -E "e2e/.profiles|e2e/.ff-profiles" | grep -v grep | wc -l`)
        .toString()
        .trim(),
    );
  } catch {}
  if (alive === 0) break;
}
rmSync(join(ROOT, 'e2e', '.profiles'), { recursive: true, force: true });
rmSync(join(ROOT, 'e2e', '.ff-profiles'), { recursive: true, force: true });

if (process.env.E2E_RESET === '1') {
  await sql('TRUNCATE bsync_op_log;');
  console.log('[ffsync] 已清空 bsync_op_log（E2E_RESET=1）');
}

const ff = await launchFirefox({ port: 9346, extraExtensions: [join(ROOT, 'e2e', 'test-bridge')] });
const { bidi } = ff;
await startBridgeServer();
const ctx = await openBridgePage(bidi);

// ── A（Chromium）：登录 → 建 A1 → 推送 ──────────────────────────────
const A = launchChromium({ port: 9345 });
const { extId: extA, sw: swA0 } = await waitForExtensionSw(9345);
const swA = await connect(swA0.webSocketDebuggerUrl);
await swA.send('Runtime.enable');
const pageA = await openPopup(9345, extA);
await loginIfNeeded(pageA, EMAIL, PASSWORD);
await ensureSpace(pageA, 'E2E FF 双向空间');
await clickSyncAndWait(pageA);
console.log('[ffsync] A(Chromium) 已就绪并首次同步');

const titleA = `A-Cr-${Date.now() % 100000}`;
await createBookmark(swA, {
  parentId: '2',
  title: titleA,
  url: 'https://e2e-a.example.com/' + Date.now(),
});
console.log('[ffsync] A 创建 A1:', titleA);
await sleep(8000); // 等事件桥 flush
await clickSyncAndWait(pageA);
console.log('[ffsync] A 已推送 A1');

// A 的 E2EE 密钥 → B
const aKey = await pageA.eval(
  `(async () => (await chrome.storage.local.get(['crdt.e2eeKey','crdt.e2eeSalt'])) )()`,
);
const bInject = await bridgeCall(bidi, ctx, 'storage.set', {
  values: {
    'crdt.e2eeKey': aKey.val?.['crdt.e2eeKey'],
    'crdt.e2eeSalt': aKey.val?.['crdt.e2eeSalt'],
  },
});
console.log('[ffsync] B 注入 A 的 E2EE 密钥:', bInject.ok ? 'ok' : JSON.stringify(bInject));
if (!aKey.val?.['crdt.e2eeKey']) {
  console.error('FAIL: A 没有 E2EE 密钥');
  process.exit(1);
}

// ── B（Firefox）：登录 → 同步 → 断言 A1 已写回 ──────────────────────
const login = await bridgeCall(bidi, ctx, 'login', { email: EMAIL, password: PASSWORD });
console.log('[ffsync] B(Firefox) login:', login.ok ? 'ok' : JSON.stringify(login));
if (!login.ok) process.exit(1);

const syncB1 = await bridgeCall(bidi, ctx, 'sync', {});
console.log('[ffsync] B 首次 sync:', JSON.stringify(syncB1));
if (!syncB1.ok) process.exit(1);

const treeB = await bridgeCall(bidi, ctx, 'bookmarks.getTree', {});
const flatB = [];
const walkB = (nodes, out) => {
  for (const n of nodes) {
    if (n.title) out.push({ title: n.title, id: n.id, parentId: n.parentId });
    if (n.children) walkB(n.children, out);
  }
};
walkB(treeB.tree ?? [], flatB);
const bHasA1 = flatB.some((n) => n.title === titleA);
console.log('[ffsync] B 树含 A1:', bHasA1, ' B 树:', flatB.map((n) => n.title).join(','));
if (!bHasA1) {
  console.error('FAIL: Firefox 未拉到 Chromium 的书签 A1（reverseApply 未生效）');
  process.exit(1);
}

// ── B 建 B1 → 推送 → A 拉到 ────────────────────────────────────────
const titleB = `B-FF-${Date.now() % 100000}`;
const createdB = await bridgeCall(bidi, ctx, 'bookmarks.create', {
  parentId: 'toolbar_____',
  title: titleB,
  url: 'https://e2e-b.example.com/' + Date.now(),
});
console.log('[ffsync] B 创建 B1:', createdB.ok ? createdB.node?.id : JSON.stringify(createdB));
if (!createdB.ok) process.exit(1);
await sleep(8000); // 等 B 事件桥 flush
await bridgeCall(bidi, ctx, 'sync', {});

await clickSyncAndWait(pageA);
const treeA = flattenTree(await getTree(swA));
const aHasB1 = treeA.some((n) => n.title === titleB);
console.log(
  '[ffsync] A 树含 B1:',
  aHasB1,
  ' A 树:',
  treeA
    .filter((n) => n.title)
    .map((n) => n.title)
    .join(','),
);
// 诊断：A 的同步水位与错误、云端 op 明细
const aDiag = await pageA.eval(
  `(async () => (await chrome.storage.local.get(['crdt.afterId','lastSyncError','lastRaError'])) )()`,
);
console.log('[ffsync][诊断] A storage:', JSON.stringify(aDiag.val));
const rows = await sql(
  'SELECT id, device_id, seq, space_id, left(op::text, 80) AS op FROM bsync_op_log ORDER BY id;',
);
console.log('[ffsync][诊断] op_log:', JSON.stringify(rows));
if (!aHasB1) {
  console.error('FAIL: Chromium 未拉到 Firefox 的书签 B1');
  process.exit(1);
}

// ── 终态收敛断言（两端各有且仅有 1 个 A1/B1）────────────────────────
const syncBFinal = await bridgeCall(bidi, ctx, 'sync', {});
console.log('[ffsync][诊断] B 终态 sync:', JSON.stringify(syncBFinal));
await clickSyncAndWait(pageA);

const treeB2 = await bridgeCall(bidi, ctx, 'bookmarks.getTree', {});
console.log('[ffsync][诊断] B 终态 getTree 原始:', JSON.stringify(treeB2.tree ?? []).slice(0, 400));
const flatB2 = [];
walkB(treeB2.tree ?? [], flatB2);
const treeA2 = flattenTree(await getTree(swA));

const count = (list, t) => list.filter((n) => n.title === t).length;
const a1InA = count(treeA2, titleA),
  b1InA = count(treeA2, titleB);
const a1InB = count(flatB2, titleA),
  b1InB = count(flatB2, titleB);
const converged = a1InA === 1 && b1InA === 1 && a1InB === 1 && b1InB === 1;
const ops = await opCount();
console.log(
  '[ffsync] 双向收敛（两端各恰 1 个 A1/B1）:',
  converged,
  `A侧=[A1×${a1InA},B1×${b1InA}] B侧=[A1×${a1InB},B1×${b1InB}]`,
);
console.log(
  '[ffsync] A 树:',
  treeA2
    .filter((n) => n.title)
    .map((n) => n.title)
    .join(','),
);
console.log('[ffsync] B 树:', flatB2.map((n) => n.title).join(','));
console.log('[ffsync] op_log 总数:', ops, ops === 2 ? '（仅 A1+B1 create）' : '（预期 2）');
if (!converged || ops !== 2) {
  console.error('FAIL: 双端未收敛 / 有重复 / op_log 数异常');
  process.exit(1);
}

// ── 菜单同步（P3 后）：Firefox menu________ ↔ Chromium「书签菜单」文件夹 ──
// 场景 M1：Firefox 在 menu________ 建书签 → Chromium 的「书签菜单」文件夹出现
const titleM1 = `M-FF-${Date.now() % 100000}`;
const m1 = await bridgeCall(bidi, ctx, 'bookmarks.create', {
  parentId: 'menu________',
  title: titleM1,
  url: 'https://e2e-menu-ff.example.com/' + Date.now(),
});
console.log('[ffsync] B 在 menu________ 建书签:', m1.ok ? m1.node?.id : JSON.stringify(m1));
if (!m1.ok) process.exit(1);
await sleep(8000); // 等事件桥 flush
await bridgeCall(bidi, ctx, 'sync', {});

await clickSyncAndWait(pageA);
const treeAM = flattenTree(await getTree(swA));
const menuFolder = treeAM.find((n) => n.title === '书签菜单');
console.log(
  '[ffsync] A 的「书签菜单」文件夹:',
  menuFolder ? `${menuFolder.id}（parent=${menuFolder.parentId}）` : '缺失!',
);
if (!menuFolder) {
  console.error('FAIL: Chromium 端没有自动创建「书签菜单」文件夹');
  process.exit(1);
}
const aHasM1 = count(treeAM, titleM1) === 1;
console.log('[ffsync] A 的菜单文件夹含 M1:', aHasM1);
if (!aHasM1) {
  console.error('FAIL: Firefox 菜单书签未同步到 Chromium 菜单文件夹');
  process.exit(1);
}

// 场景 M2：Chromium 在「书签菜单」文件夹建书签 → Firefox menu________ 出现
const titleM2 = `M-Cr-${Date.now() % 100000}`;
await createBookmark(swA, {
  parentId: menuFolder.id,
  title: titleM2,
  url: 'https://e2e-menu-cr.example.com/' + Date.now(),
});
console.log('[ffsync] A 在「书签菜单」建书签:', titleM2);
await sleep(8000);
await clickSyncAndWait(pageA);
await bridgeCall(bidi, ctx, 'sync', {});

const treeB3 = await bridgeCall(bidi, ctx, 'bookmarks.getTree', {});
const flatB3 = [];
walkB(treeB3.tree ?? [], flatB3);
const bHasM2 = count(flatB3, titleM2) === 1;
console.log('[ffsync] B 的 menu________ 含 M2:', bHasM2);
if (!bHasM2) {
  console.error('FAIL: Chromium 菜单书签未同步到 Firefox 菜单');
  process.exit(1);
}

// 菜单终态：双向各恰 1（无重复）
const treeA3 = flattenTree(await getTree(swA));
const treeB4 = await bridgeCall(bidi, ctx, 'bookmarks.getTree', {});
const flatB4 = [];
walkB(treeB4.tree ?? [], flatB4);
const menuConverged =
  count(treeA3, titleM1) === 1 &&
  count(treeA3, titleM2) === 1 &&
  count(flatB4, titleM1) === 1 &&
  count(flatB4, titleM2) === 1;
console.log(
  '[ffsync] 菜单双向收敛（M1/M2 两端各恰 1）:',
  menuConverged,
  `A侧=[M1×${count(treeA3, titleM1)},M2×${count(treeA3, titleM2)}] ` +
    `B侧=[M1×${count(flatB4, titleM1)},M2×${count(flatB4, titleM2)}]`,
);
if (!menuConverged) {
  console.error('FAIL: 菜单书签双向未收敛');
  process.exit(1);
}

stopBridgeServer();
try {
  execSync(
    `ps -eo pid,args | grep "e2e/.ff-profiles" | grep -v grep | awk '{print $1}' | xargs -r kill 2>/dev/null || true`,
  );
} catch {}
console.log(
  '\n✅ e2e-ff-sync 通过：Chromium × Firefox 跨浏览器双向同步收敛正常（含书签菜单 menu________ ↔ 书签菜单文件夹）',
);
process.exit(0);
