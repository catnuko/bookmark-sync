/**
 * e2e/lib/popup.mjs — popup / SW 操作 helper。
 *
 * 覆盖真实 Chromium 交互的关键坑：
 * - Vue v-model 需要真实键盘输入（Input.insertText），直接设 value 会被忽略
 * - 登录/同步按钮有 busy 状态，等待其解除
 * - chrome.bookmarks 操作在 SW 上下文执行（CDP 直连 service_worker target）
 */
import { connect, openPage, sleep } from './cdp.mjs';

export async function openPopup(port, extId) {
  const page = await openPage(port, `chrome-extension://${extId}/popup.html`);
  await sleep(2000);
  return page;
}

export async function bodyText(page) {
  const r = await page.eval(`document.body.innerText`);
  return r.val ?? '';
}

export async function isLoggedIn(page) {
  const t = await bodyText(page);
  return t.includes('退出') && /@/.test(t);
}

/** 已登录返回 true；否则填表登录（邮箱+密码），成功后返回 true。 */
export async function loginIfNeeded(page, email, password) {
  if (await isLoggedIn(page)) return true;
  const setInput = async (selector, value) => {
    // Vue 渲染有延迟：轮询等待 selector 出现（最多 15s）
    let found = false;
    for (let i = 0; i < 30; i++) {
      const r = await page.eval(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (r.val) { found = true; break; }
      await sleep(500);
    }
    if (!found) throw new Error(`找不到输入框 ${selector}`);
    // Vue v-model 需要真实键盘输入：先 focus 再 insertText
    await page.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page.send('Input.insertText', { text: value });
    await sleep(200);
  };
  await setInput('#email', email);
  await setInput('#password', password);
  await page.eval(`document.querySelector('#authSubmit').click()`);
  // 等待登录完成（出现"退出"按钮）
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await isLoggedIn(page)) return true;
  }
  const t = await bodyText(page);
  throw new Error(`登录超时。popup 内容: ${t.slice(0, 120)}`);
}

/**
 * Best-effort 确保账号下存在空间：无则尝试创建（duplicate 视为成功）。
 * 不依赖 storage.activeSpaceId（新空间没有该键；runSync 的 getActiveSpace
 * 直接查库取 is_default/最早空间）。
 */
export async function ensureSpace(page, name = 'E2E 空间') {
  const t = await bodyText(page);
  // 已显示空间名（面板里有空间列表）→ 直接认为有空间
  const r = await page.eval(`(async () => {
    const { data } = await new Promise((res) => {
      // 通过 storage 间接判断是否同步过空间（不可靠），改为检查面板
      res({ data: null });
    });
    return null;
  })()`);
  // 打开空间面板（若未展开）
  const hasPanel = await page.eval(`!![...document.querySelectorAll('button')].find(b => b.textContent.includes('空间与设备'))`);
  if (hasPanel) {
    await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('空间与设备'))?.click()`);
    await sleep(500);
  }
  // 面板里若已有空间名（row），说明存在空间，直接返回
  const panelText = await bodyText(page);
  const hasSpaceRow = await page.eval(`!![...document.querySelectorAll('.row .row-name')].length`);
  if (hasSpaceRow) return true;

  // 无空间：填名创建
  const hasInput = await page.eval(`!![...document.querySelectorAll('input')].find(i => i.placeholder.includes('新空间名称'))`);
  if (hasInput) {
    await page.eval(`([...document.querySelectorAll('input')].find(i => i.placeholder.includes('新空间名称'))).focus()`);
    await page.send('Input.insertText', { text: name });
    await page.eval(`([...document.querySelectorAll('button')].find(b => b.textContent.trim() === '创建'))?.click()`);
    await sleep(2000);
  }
  return true; // duplicate/成功都视为已保证存在
}

/**
 * 点击立即同步并等待完成。
 * 以 storage.lastSyncAt 变化为准（background 每次同步都会更新时间戳），
 * 不依赖状态字符串（结果相同时字符串不变）也不依赖 UI busy。
 */
export async function clickSyncAndWait(page, timeoutMs = 90000) {
  const before = await readStorageLocal(page, 'lastSyncAt');
  await page.eval(`document.querySelector('#syncNow')?.click()`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const now = await readStorageLocal(page, 'lastSyncAt');
    const status = await readStorageLocal(page, 'lastSyncStatus');
    if (now && now !== before) return { status: status ?? '', text: await bodyText(page) };
  }
  const t = await bodyText(page);
  throw new Error(`同步超时。popup: ${t.split('\n').filter(Boolean).slice(-10).join(' | ')}`);
}

/** 在 SW 上下文调用 chrome.bookmarks（create/getTree/removeTree…）。 */
export async function swBookmarks(swCdp, expr) {
  const r = await swCdp.eval(`chrome.bookmarks.${expr}.then(v => JSON.stringify(v))`);
  if (r.err) throw new Error(`chrome.bookmarks.${expr} 失败: ${r.err}`);
  return JSON.parse(r.val);
}

export async function createBookmark(swCdp, { parentId = '2', title, url }) {
  return swBookmarks(swCdp, `create({ parentId: ${JSON.stringify(parentId)}, title: ${JSON.stringify(title)}, url: ${JSON.stringify(url)} })`);
}

export async function getTree(swCdp) {
  return swBookmarks(swCdp, 'getTree()');
}

/** 把 chrome 书签树拍平成 [ {id,parentId,title,url} ]，便于断言。 */
export function flattenTree(tree) {
  const out = [];
  const walk = (node, parentId) => {
    out.push({ id: node.id, parentId, title: node.title, url: node.url ?? null });
    for (const c of node.children ?? []) walk(c, node.id);
  };
  for (const root of tree) walk(root, null);
  return out;
}

export async function readStorageLocal(page, key) {
  const r = await page.eval(`(async () => (await chrome.storage.local.get(${JSON.stringify(key)}))[${JSON.stringify(key)}] ?? null)()`);
  return r.val;
}
