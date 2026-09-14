/**
 * e2e/debug-create.mjs — 诊断 reverseApply 的 chrome.bookmarks.create 调用。
 *
 * 包装 B SW 的 bookmarks.create 记录真实入参，A 建书签后 B 同步，抓入参与错误。
 * 用法：EMAIL=xxx PASSWORD=yyy node e2e/debug-create.mjs
 */
import { launchChromium } from './lib/launch.mjs';
import { waitForExtensionSw, connect, sleep } from './lib/cdp.mjs';
import { openPopup, loginIfNeeded, ensureSpace, clickSyncAndWait, createBookmark, getTree, flattenTree, readStorageLocal } from './lib/popup.mjs';
import { sql } from './lib/supabase.mjs';

const EMAIL = process.env.EMAIL, PASSWORD = process.env.PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('need EMAIL/PASSWORD'); process.exit(1); }
await sql('TRUNCATE bsync_op_log;');

const A = launchChromium({ port: 9345 });
const B = launchChromium({ port: 9346 });
const [A_, B_] = await Promise.all([waitForExtensionSw(9345), waitForExtensionSw(9346)]);
const swA = await connect(A_.sw.webSocketDebuggerUrl);
await swA.send('Runtime.enable');
const swB = await connect(B_.sw.webSocketDebuggerUrl);
await swB.send('Runtime.enable');

const pageA = await openPopup(9345, A_.extId);
await loginIfNeeded(pageA, EMAIL, PASSWORD);
await ensureSpace(pageA, 'DIAG 空间');
await clickSyncAndWait(pageA);
console.log('[diag] A 首同完成（播种）');

const pageB = await openPopup(9346, B_.extId);
await loginIfNeeded(pageB, EMAIL, PASSWORD);
await ensureSpace(pageB, 'DIAG 空间');
const aKey = await pageA.eval(`(async () => (await chrome.storage.local.get(['crdt.e2eeKey','crdt.e2eeSalt'])) )()`);
await pageB.eval(`(async () => { const a = ${JSON.stringify(aKey.val ?? {})}; await chrome.storage.local.set({'crdt.e2eeKey':a['crdt.e2eeKey'],'crdt.e2eeSalt':a['crdt.e2eeSalt']}); return !!a['crdt.e2eeKey']; })()`);
console.log('[diag] B 已注入密钥');
await clickSyncAndWait(pageB);
console.log('[diag] B 首同完成');

const wrap = await swB.eval(`(() => {
  globalThis.__calls = [];
  const b = chrome.bookmarks;
  if (b.__wrapped) return 'already-wrapped';
  const orig = b.create.bind(b);
  b.create = (...a) => {
    try { globalThis.__calls.push((new Error()).stack?.split('\n').slice(1,4).join(' || ') + ' => ' + a.map(x => { try { return JSON.stringify(x) } catch { return String(x) } }).join(' | ')); } catch {}
    return orig(...a);
  };
  b.__wrapped = true;
  return 'wrapped';
})()`);
console.log('[diag] B SW create 包装:', wrap.val, wrap.err ?? '');

const titleA = `DIAG-A-${Date.now() % 100000}`;
const a1 = await createBookmark(swA, { parentId: '2', title: titleA, url: 'https://diag.example.com/' + Date.now() });
console.log('[diag] A 创建:', a1.id, titleA);
await sleep(8000);

const bSync = await clickSyncAndWait(pageB);
console.log('[diag] B 同步状态:', bSync.status?.slice(0, 300));

const calls = await swB.eval(`JSON.stringify(globalThis.__calls ?? [])`);
console.log('[diag] B SW create 入参记录:', calls.val);
const st2 = await readStorageLocal(pageB, 'lastSyncStatus');
console.log('[diag] B 同步后 lastSyncStatus:', st2);
const treeB = flattenTree(await getTree(swB));
console.log('[diag] B 树:', treeB.filter(n => n.title).map(n => `${n.title}@${n.id}`).join(','));
console.log('[diag] B 含 A1:', treeB.some(n => n.title === titleA));
process.exit(0);
