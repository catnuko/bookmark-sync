/**
 * e2e/lib/chrome.mjs — 启动真实 Chrome 并驱动「一台设备」。
 *
 * 一台设备 = 一个独立 user-data-dir（profile）+ 一个调试端口 + 一份扩展实例。
 * 双设备测试就是起两个互不相干的 profile：书签、chrome.storage、SW 全都隔离，
 * 等价于两个浏览器窗口/两台电脑，且**不碰你日常 Chrome 的任何数据**。
 *
 * Chrome 137+ 移除了 `--load-extension`（品牌版 Google Chrome 已不认该开关），
 * 所以这里的主路径是 CDP 的 `Extensions.loadUnpacked`（需要 `--enable-unsafe-extension`），
 * 同时仍然传 `--load-extension` 给 Chromium / chrome-for-testing 兜底，两条路都留着。
 *
 * 无头也带 `--disable-background-timer-throttling` 等：MV3 Service Worker 被后台节流
 * 会让同步「卡住不动」，测试里最难查的就是这种假死。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { connect, sleep, waitForExtensionSw } from './cdp.mjs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/local/bin/chromium',
  '/opt/browser/chrome',
];

export function findChromeBinary() {
  const fromEnv = process.env.CHROME_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (hit) return hit;
  throw new Error(
    `找不到 Chrome：设置 CHROME_BIN，或装到下列任一位置\n  ${CHROME_CANDIDATES.join('\n  ')}`,
  );
}

async function waitForCdp(port, timeoutMs = 30_000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch (e) {
      last = e.message;
    }
    await sleep(300);
  }
  throw new Error(`Chrome 调试端口 ${port} 未就绪（${last}）`);
}

async function listTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  return r.ok ? await r.json() : [];
}

/**
 * 清掉占用该调试端口的残留 Chrome。
 *
 * 上一次跑崩（尤其是 SIGKILL）会留下僵尸实例，此时新一轮「扩展已加载但 SW 不启动」
 * ——实测就是这么翻车的：loadUnpacked 正常返回 id，`/json/list` 里却永远没有
 * background.js。启动前先腾干净，比事后猜参数靠谱。
 */
function killPort(port) {
  let pids = [];
  try {
    pids = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split('\n')
      .map((s) => Number(s.trim()))
      .filter(Boolean);
  } catch {
    return; // lsof 无输出/不存在 = 没占用
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* 已退出 */
    }
  }
  return pids.length;
}

async function waitPortFree(port, timeoutMs = 6_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(600),
      });
      if (!r.ok) return true;
    } catch {
      return true; // 连不上 = 已释放
    }
    await sleep(300);
  }
  return false;
}

/** 打开一个 target 并返回其 CDP 连接（`/json/new` 失败时退回 browser 级 createTarget）。 */
async function openTarget(port, browserCdp, url) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    });
    if (r.ok) {
      const t = await r.json();
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    }
  } catch {
    // 落到下面的 createTarget
  }
  const res = await browserCdp.send('Target.createTarget', { url });
  const targetId = res.result?.targetId;
  for (let i = 0; i < 60; i++) {
    const t = (await listTargets(port)).find((x) => x.id === targetId);
    if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    await sleep(200);
  }
  throw new Error(`无法打开页面 ${url}`);
}

/** 单个扩展页面（popup.html / options.html）的驱动句柄。 */
class Page {
  constructor(cdp, url, name) {
    this.cdp = cdp;
    this.url = url;
    this.name = name;
  }

  /** 求值并返回 JS 值；页面内抛异常 → 本方法抛错（带原始描述，便于定位）。 */
  async eval(expression) {
    const r = await this.cdp.eval(expression);
    if (r.err)
      throw new Error(
        `[${this.name}] 求值失败: ${r.desc ?? r.err}\n  表达式: ${expression.slice(0, 160)}`,
      );
    return r.val;
  }

  /** 求值但允许异常（断言用：元素不存在时返回 null 而不是中断脚本）。 */
  async tryEval(expression) {
    const r = await this.cdp.eval(expression);
    return r.err ? null : r.val;
  }

  async exists(selector) {
    return (await this.tryEval(`!!document.querySelector(${JSON.stringify(selector)})`)) === true;
  }

  async text() {
    return (await this.tryEval('document.body ? document.body.innerText : ""')) ?? '';
  }

  async textOf(selector) {
    return (
      (await this.tryEval(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.innerText : null; })()`,
      )) ?? ''
    ).trim();
  }

  async click(selector) {
    const ok = await this.tryEval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
    );
    if (!ok) throw new Error(`[${this.name}] 找不到可点击元素 ${selector}`);
    await sleep(120);
  }

  /**
   * 按可见文案点击（选择器命中多个时用）。
   *
   * 界面上有 4 个长得一模一样的抽屉入口行（空间/密钥/高级/帮助），只有文案不同；
   * 硬编码第几个会在加新行时静默点错。文案从扩展自己的 i18n 取（调用方负责），
   * 改文案时测试会一起失败 —— 这是想要的行为。
   */
  async clickByText(selector, text) {
    const ok = await this.tryEval(
      `(() => {
         const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
         const el = els.find((e) => (e.innerText ?? '').includes(${JSON.stringify(text)}));
         if (!el) return false;
         el.click();
         return true;
       })()`,
    );
    if (!ok) {
      // 失败时带上页面当前文案，方便判断是「元素不在」还是「停在了别的屏」
      const hint =
        (await this.tryEval(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 200)`)) ?? '';
      throw new Error(
        `[${this.name}] 文案含「${text}」的可点击元素不存在（选择器 ${selector}）｜页面文案: ${hint}`,
      );
    }
    await sleep(120);
  }

  /**
   * 填入文本。
   *
   * 必须走真实输入（`Input.insertText`）：Vue 的 v-model 认的是元素上冒泡的 input
   * 事件，CDP 里直接改 `el.value` 不会触发（这条坑在 e2e/README 里记过）。
   * 先用 `el.select()` 制造选区，insertText 会替换选区，等价于「全选后输入」。
   * 最后校验一次实际值，不一致就退到原生 setter + 手工派发 input 事件。
   */
  async fill(selector, value) {
    const focused = await this.tryEval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select?.(); return true; })()`,
    );
    if (!focused) throw new Error(`[${this.name}] 找不到输入框 ${selector}`);
    await this.cdp.send('Input.insertText', { text: value });
    await sleep(150);
    let got = await this.tryEval(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.value : null; })()`,
    );
    if (got !== value) {
      await this.eval(
        `(() => {
           const el = document.querySelector(${JSON.stringify(selector)});
           const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
           setter.call(el, ${JSON.stringify(value)});
           el.dispatchEvent(new Event('input', { bubbles: true }));
         })()`,
      );
      await sleep(150);
      got = await this.tryEval(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.value : null; })()`,
      );
    }
    if (got !== value)
      throw new Error(
        `[${this.name}] 输入未生效：${selector} 期望 ${value.length} 字符、实际 ${got?.length ?? 0}`,
      );
    return got;
  }

  async waitForSelector(selector, timeoutMs = 15_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await this.exists(selector)) return true;
      await sleep(250);
    }
    return false;
  }

  /** 轮询直到 fn(page) 返回真值；返回最后一个真值，超时返回 null。 */
  async waitUntil(fn, { timeoutMs = 20_000, intervalMs = 350 } = {}) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      last = await fn(this);
      if (last) return last;
      await sleep(intervalMs);
    }
    return null;
  }

  async close() {
    await this.cdp.close();
  }
}

/** 一台设备（一个 profile + 一份扩展实例）。 */
export class Device {
  constructor({ name, port, profileDir, extId, browser, child }) {
    this.name = name;
    this.port = port;
    this.profileDir = profileDir;
    this.extId = extId;
    this.browser = browser;
    this.child = child;
    this.sw = null;
    this.popup = null;
  }

  /** 在 Service Worker realm 求值（唯一能直接调 chrome.bookmarks 的地方）。 */
  async swEval(expression) {
    const r = await this.sw.eval(expression);
    if (r.err) throw new Error(`[${this.name}/SW] 求值失败: ${r.desc ?? r.err}`);
    return r.val;
  }

  /** 读 chrome.storage.local（不传 keys = 全量）。 */
  async storage(keys = null) {
    return this.swEval(
      `(async () => { const v = await chrome.storage.local.get(${JSON.stringify(keys)}); return v; })()`,
    );
  }

  async storageKey(key) {
    const all = await this.storage(key);
    return all?.[key] ?? null;
  }

  /** 扩展自己的 i18n 文案（断言时用真实界面文案，而不是脚本里另抄一份）。 */
  async i18n(key) {
    return this.swEval(`chrome.i18n.getMessage(${JSON.stringify(key)})`);
  }

  async uiLanguage() {
    return this.swEval('chrome.i18n.getUILanguage()');
  }

  /** 打开（或复用）扩展页面。popup 与 options 是同一套 store，门禁两处都会挡。 */
  async openPage(file) {
    const url = `chrome-extension://${this.extId}/${file}`;
    const ws = await openTarget(this.port, this.browser, url);
    const page = new Page(await connect(ws), url, `${this.name}:${file}`);
    if (!(await page.waitForSelector('#app', 20_000))) {
      throw new Error(`[${page.name}] 页面未渲染 #app（扩展加载失败？）`);
    }
    return page;
  }

  async openPopup() {
    if (!this.popup) this.popup = await this.openPage('popup.html');
    return this.popup;
  }

  /**
   * 建书签（走 SW 的 chrome.bookmarks，触发真实的 onCreated 事件 → 进事件桥）。
   * 比在 UI 上点更接近真机行为，也避免依赖书签管理界面的 DOM。
   */
  async bookmarksCreate({ parentId, title, url }) {
    return this.swEval(
      `(async () => await chrome.bookmarks.create(${JSON.stringify({ parentId, title, url })}))()`,
    );
  }

  async bookmarksGetTree() {
    return this.swEval('(async () => await chrome.bookmarks.getTree())()');
  }

  /** 「其他书签」根 id：Chrome 通常是 '2'，从树里查出来更稳。 */
  async otherBookmarksId() {
    const tree = await this.bookmarksGetTree();
    const roots = tree?.[0]?.children ?? [];
    const other = roots.find((c) => c.id !== '1') ?? roots[1];
    if (!other) throw new Error(`[${this.name}] 找不到「其他书签」根`);
    return other.id;
  }

  /**
   * 「书签栏」根 id：Chrome 通常是 '1'，从树里查出来更稳。
   *
   * 为什么单独要一个：**默认空间的落地区就是原生书签栏**（多空间里其它空间的容器
   * 也挂在它下面），所以「书签栏」和「其他书签」不是等价的测试面 —— 顺序类断言
   * 落在哪一侧，走的分支可能完全不同。
   */
  async bookmarksBarId() {
    const tree = await this.bookmarksGetTree();
    const roots = tree?.[0]?.children ?? [];
    const bar = roots.find((c) => c.id === '1') ?? roots[0];
    if (!bar) throw new Error(`[${this.name}] 找不到「书签栏」根`);
    return bar.id;
  }

  /**
   * 触发一次同步：**必须从扩展页面发消息**，SW 不会收到自己发的 sendMessage。
   * SW 是同步权威（事件桥与 coordinator 同 realm），在页面上下文直接跑同步会
   * 另建一份 CRDT 状态（e2e/README 里记过这条坑）。
   */
  async triggerSync(timeoutMs = 60_000) {
    const page = await this.openPopup();
    const res = await page.eval(
      `new Promise((resolve) => {
         if (!chrome?.runtime?.sendMessage) return resolve({ ok: false, reason: 'no_runtime' });
         const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ${timeoutMs - 2_000});
         chrome.runtime.sendMessage({ type: 'bsync-sync' }, (r) => { clearTimeout(timer); resolve(r ?? { ok: false, reason: 'no_response' }); });
       })`,
    );
    return res;
  }

  async close({ keepProfile = false } = {}) {
    try {
      for (const t of await listTargets(this.port)) {
        if (t.webSocketDebuggerUrl) await fetch(`http://127.0.0.1:${this.port}/json/close/${t.id}`);
      }
    } catch {
      // 目标列表拿不到（已退出）就跳过
    }
    await this.sw?.close().catch(() => {});
    await this.popup?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    // 优雅退出：SIGKILL 会损坏 profile（e2e/README 场景 3 记过）
    try {
      this.child.kill('SIGTERM');
    } catch {
      /* 已退出 */
    }
    const t0 = Date.now();
    while (this.child.exitCode === null && Date.now() - t0 < 8_000) await sleep(200);
    if (this.child.exitCode === null) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    if (!keepProfile) {
      try {
        rmSync(this.profileDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 拿到一个**干净**的 profile 目录。
 *
 * 首选原地清空；但删除可能失败（企业策略 / 沙箱 / 权限会拦批量递归删除：一个
 * Chrome profile 有上千个文件）。删除失败时**退化成一个全新的兄弟目录**——效果
 * 等价于「干净 profile」，而且完全不依赖删除成功，旧目录留给 `run.mjs clean` 扫。
 *
 * 为什么不能让删除失败直接抛：那会把「环境不允许删文件」变成「测试跑不起来」，
 * 而这两件事毫无关系。
 *
 * @returns {{dir:string, rotated:boolean, reason?:string}}
 */
function ensureFreshProfile(profileDir) {
  try {
    rmSync(profileDir, { recursive: true, force: true });
    mkdirSync(profileDir, { recursive: true });
    return { dir: profileDir, rotated: false };
  } catch (e) {
    const dir = `${profileDir}.${Date.now().toString(36)}`;
    mkdirSync(dir, { recursive: true });
    return { dir, rotated: true, reason: e.message.split('\n')[0].slice(0, 120) };
  }
}

/**
 * 等 SW 全局**真的可用**（`chrome.bookmarks` 已注入）。
 *
 * 坑：SW target 出现在 `/json/list` 里 ≠ 扩展 API 已装好。MV3 的 SW 是「先有
 * target、后装 `chrome.*` 绑定」，中间那段窗口里 `Runtime.evaluate` 落在一个空
 * context 上，直接抛 `ReferenceError: chrome is not defined`；同一连接稍后重试
 * 就正常（实测 devB 上就是这么自愈的）。谁在 `launchDevice` 之后**立刻** swEval
 * 谁就踩中 —— `seed-before-sync` 要在登录前播种，是唯一这样的场景；先过门禁的
 * 场景因为要等 popup 渲染几秒，反而看不出来。
 *
 * 所以把「SW 存在」升级成「SW 可用」再返回设备，别把这段竞态留给调用方。
 */
async function waitSwReady(sw, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await sw.eval('(typeof chrome !== "undefined" && !!chrome.bookmarks)');
    if (r.err === null && r.val === true) return true;
    last = r.err ?? r.val;
    await sleep(200);
  }
  throw new Error(`扩展 SW 未就绪：${timeoutMs}ms 内 chrome.bookmarks 仍不可用（最后：${last}）`);
}

/** 启动一台设备并加载扩展，等 SW 就绪后返回驱动句柄。 */
export async function launchDevice(opts) {
  const { name, port } = opts;
  try {
    return await launchOnce(opts);
  } catch (e) {
    // 实测的偶发：扩展已加载但 SW 不启动（上一轮残留进程 / 扩展服务初始化竞态）。
    // 清掉端口残留后重试一次，胜过让整轮 E2E 白跑。
    if (!/SW 未(在|就绪)/.test(e.message ?? '')) throw e;
    console.error(`[${name}] 首次启动没拿到扩展 SW，清理端口 ${port} 后重试一次…`);
    killPort(port);
    await waitPortFree(port);
    return await launchOnce(opts);
  }
}

async function launchOnce({
  name,
  port,
  profileDir,
  extDir,
  headless = true,
  freshProfile = true,
  bootTimeoutMs = 45_000,
}) {
  if (!existsSync(join(extDir, 'background.js'))) {
    throw new Error(`扩展产物不存在: ${extDir}/background.js（先跑 npx vite build）`);
  }
  killPort(port);
  await waitPortFree(port);
  let activeProfileDir = profileDir;
  if (freshProfile) {
    const p = ensureFreshProfile(profileDir);
    activeProfileDir = p.dir;
    if (p.rotated) {
      // 不是错误，但要让人知道：旧 profile 还在磁盘上，跑完用 `run.mjs clean` 扫掉。
      console.error(`[${name}] 无法清空 profile（${p.reason}）→ 换用全新目录 ${p.dir}`);
    }
  } else {
    mkdirSync(profileDir, { recursive: true });
  }

  const bin = findChromeBinary();
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension', // Chrome 137+ 用 CDP 加载未打包扩展的前提
    '--load-extension=' + extDir, // 旧版 Chromium / chrome-for-testing 走这条（新版品牌 Chrome 忽略）
    // ⚠ 不要加 --disable-extensions-except：它会把 CDP 加载进来的未打包扩展限制成
    //    「已加载但未启用」，SW 不会启动（Chrome 153 macOS 实测）。二分法定位记录见 e2e/README。
    // 后台节流会让 MV3 SW 假死，同步测试最怕这个
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${activeProfileDir}`,
    '--window-size=520,760',
  ];
  if (headless) args.push('--headless=new');

  const child = spawn(bin, args, { stdio: 'ignore', detached: false });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`[${name}] Chrome 退出码 ${code}`);
  });

  const version = await waitForCdp(port, bootTimeoutMs);
  const browser = await connect(version.webSocketDebuggerUrl);

  // 主路径：CDP 加载未打包扩展（品牌 Chrome 只能走这条）。
  const loaded = await browser.send('Extensions.loadUnpacked', { path: extDir });
  const expectedId = loaded.result?.id ?? null;
  if (loaded.error && !String(loaded.error.message ?? '').includes('already')) {
    console.error(`[${name}] Extensions.loadUnpacked 警告: ${JSON.stringify(loaded.error)}`);
  }

  // 主动唤醒：打开扩展自己的一个页面，扩展服务会被拉起、SW 随之启动。空等
  // （尤其无头下）有时等不到，这一步把「等」变成「推」。
  const popupUrl = expectedId ? `chrome-extension://${expectedId}/popup.html` : null;
  let wakeWsUrl = null;
  if (popupUrl) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(popupUrl)}`, {
        method: 'PUT',
      });
      if (r.ok) wakeWsUrl = (await r.json())?.webSocketDebuggerUrl ?? null;
    } catch {
      /* 唤醒失败不影响主流程，后面 waitForExtensionSw 还会等 */
    }
  }

  const { extId } = await waitForExtensionSw(port, bootTimeoutMs, expectedId);
  const swTarget = (await listTargets(port)).find(
    (t) =>
      t.type === 'service_worker' &&
      t.url.includes('/background.js') &&
      (!expectedId || new URL(t.url).host === expectedId),
  );
  const sw = await connect(swTarget.webSocketDebuggerUrl);
  await waitSwReady(sw, bootTimeoutMs);

  const device = new Device({ name, port, profileDir: activeProfileDir, extId, browser, child });
  device.sw = sw;

  // 复用唤醒用的那个 tag 作为 popup 句柄（避免同一 profile 里挂两个 popup 页，
  // 两个实例各跑一份 init() 会互相干扰）。
  if (wakeWsUrl) {
    const page = new Page(await connect(wakeWsUrl), popupUrl, `${name}:popup.html`);
    if (await page.waitForSelector('#app', 15_000)) device.popup = page;
    else await page.close().catch(() => {});
  }
  return device;
}
