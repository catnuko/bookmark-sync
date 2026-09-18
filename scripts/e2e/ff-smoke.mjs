/**
 * e2e/ff-smoke.mjs — Firefox 桥通道冒烟验证（P1 第二步）。
 *
 * 链路：Firefox 启动 → 装 bookmark-sync + test-bridge → 桥页面 →
 * __testBridge 驱动扩展：登录 → 同步 → 建书签 → 读树 → 触发同步。
 *
 * 用法：
 *   EMAIL=xxx PASSWORD=yyy E2E_RESET=1 node e2e/ff-smoke.mjs
 */
import { launchFirefox } from './lib/launchFirefox.mjs';
import { startBridgeServer, openBridgePage, bridgeCall, waitFor, stopBridgeServer } from './lib/ffbridge.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { opCount, sql } from './lib/supabase.mjs';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('需要 EMAIL / PASSWORD 环境变量');
  process.exit(1);
}

// 自清理：杀残留测试 Firefox + 删 profile（复用旧 profile 会导致临时扩展
// content script 未重新注入，桥 ping 卡死；每次从干净起点验证）
try {
  execSync(`ps -eo pid,args | grep "e2e/.ff-profiles" | grep -v grep | awk '{print $1}' | xargs -r kill -9 2>/dev/null || true`);
} catch {}
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  let alive = 0;
  try { alive = Number(execSync(`ps -eo args | grep "e2e/.ff-profiles" | grep -v grep | wc -l`).toString().trim()); } catch {}
  if (alive === 0) break;
}
rmSync(join(ROOT, 'e2e', '.ff-profiles'), { recursive: true, force: true });

if (process.env.E2E_RESET === '1') {
  await sql('TRUNCATE bsync_op_log;');
  console.log('[ff] 已清空 bsync_op_log（E2E_RESET=1）');
}

const BRIDGE_DIR = join(ROOT, 'e2e', 'test-bridge');
const ff = await launchFirefox({
  port: 9346,
  extraExtensions: [BRIDGE_DIR],
});
const { bidi } = ff;
await startBridgeServer();
const ctx = await openBridgePage(bidi);

// 1) 登录
const login = await bridgeCall(bidi, ctx, 'login', { email: EMAIL, password: PASSWORD });
console.log('[ff] login:', login.ok ? 'ok' : JSON.stringify(login));
if (!login.ok) process.exit(1);

// 2) 首次同步
const sync1 = await bridgeCall(bidi, ctx, 'sync', {});
console.log('[ff] sync1:', JSON.stringify(sync1));

// 3) 建书签（Firefox toolbar 根 guid）
const title = `FF-设备-${Date.now() % 100000}`;
const created = await bridgeCall(bidi, ctx, 'bookmarks.create', {
  parentId: 'toolbar_____', title, url: 'https://e2e-ff.example.com/' + Date.now(),
});
console.log('[ff] create:', created.ok ? created.node?.id : JSON.stringify(created));
if (!created.ok) process.exit(1);

// 4) 触发同步（事件桥 flush + runSync）
await bridgeCall(bidi, ctx, 'sync', {});

// 5) 读树断言
const tree = await bridgeCall(bidi, ctx, 'bookmarks.getTree', {});
const flat = [];
const walk = (nodes) => { for (const n of nodes) { if (n.title) flat.push(n.title); if (n.children) walk(n.children); } };
walk(tree.tree ?? []);
const has = flat.includes(title);
console.log('[ff] 树含新建书签:', has, ' 树:', flat.join(','));
console.log('[ff] op_log 总数:', await opCount());

console.log('\n' + (has ? '✅ ff-smoke 通过' : '❌ FAIL: 书签未出现在树中'));
stopBridgeServer();
process.exit(has ? 0 : 1);
