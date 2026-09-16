/**
 * e2e/e2e-single.mjs — 单设备闭环：登录 → 空间 → 同步 → 建书签 → 落库密文。
 *
 * 验证：
 *   1. 登录 Supabase
 *   2. 同步（SW 权威）建立 coordinator，事件桥注册
 *   3. 创建书签 → 事件捕获 → op 入队 → 去抖推送 → bsync_op_log +N
 *   4. op 均为 AES-GCM 密文信封 {iv, ciphertext}（服务端不可见内容）
 *   5. 再次同步 → reverseApply 写回（幂等，本机树不丢书签）
 *
 * 用法（先 pnpm package 再运行）：
 *   EMAIL=xxx@x.com PASSWORD=yyy node e2e/e2e-single.mjs
 */
import { launchChromium } from './lib/launch.mjs';
import { waitForExtensionSw, connect, sleep } from './lib/cdp.mjs';
import { openPopup, loginIfNeeded, ensureSpace, clickSyncAndWait, createBookmark, getTree, flattenTree, bodyText } from './lib/popup.mjs';
import { sql, opCount, opRows } from './lib/supabase.mjs';

const EMAIL = process.env.EMAIL;
const PASSWORD = process.env.PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('需要 EMAIL / PASSWORD 环境变量（登录 Supabase 账号）');
  process.exit(1);
}

const { port } = launchChromium();
// 等待扩展 SW 出现（newtab 会比 SW 先就绪，直接用 waitForTargets 会误判未加载）
const { extId, sw } = await waitForExtensionSw(port);
const swCdp = await connect(sw.webSocketDebuggerUrl);
console.log(`[single] 扩展 id: ${extId}`);

const page = await openPopup(port, extId);
await loginIfNeeded(page, EMAIL, PASSWORD);
console.log('[single] 登录成功');

const spaceId = await ensureSpace(page, 'E2E 单设备空间');
console.log('[single] 空间:', spaceId);

await clickSyncAndWait(page);
console.log('[single] 首次同步完成');

const before = await opCount();
const bm = await createBookmark(swCdp, { parentId: '2', title: `E2E-单设备-${Date.now() % 100000}`, url: `https://e2e-single.example.com/${Date.now()}` });
console.log('[single] 创建书签:', bm.id, bm.title);
await sleep(8000); // flushSoon 2s + 网络往返

const after = await opCount();
console.log(`[single] op_log: ${before} -> ${after}`);
if (after <= before) {
  console.error('FAIL: 创建书签后 op_log 未增长（事件捕获/推送断线）');
  process.exit(1);
}

const rows = await opRows();
const allEncrypted = rows.every((r) => r.is_encrypted && r.has_ct);
console.log(`[single] op 密文: ${allEncrypted ? '全部 {iv,ciphertext} ✓' : '存在明文 op ✗'}`);
if (!allEncrypted) process.exit(1);

// 再次同步 → reverseApply 幂等写回
await clickSyncAndWait(page);
const tree = flattenTree(await getTree(swCdp));
console.log('[single] chrome 树节点数:', tree.length, ' 含新建书签:', tree.some((n) => n.title === bm.title));
if (!tree.some((n) => n.title === bm.title)) {
  console.error('FAIL: 本机树缺少刚创建的书签');
  process.exit(1);
}

console.log('\n✅ e2e-single 全部通过');
console.log('最后 popup 状态:', (await bodyText(page)).split('\n').filter(Boolean).slice(-6).join(' | '));
process.exit(0);
