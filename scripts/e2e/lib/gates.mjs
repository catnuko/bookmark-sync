/**
 * e2e/lib/gates.mjs — 门禁识别与操作。
 *
 * App.vue 是个互斥渲染链：
 *   AuthView → boot 占位 → PhraseGate → BindSpaceGate → PopupView/OptionsView
 * 所以「当前处于哪一关」可以由 DOM 唯一确定（各自的根节点不同），断言就不用去猜
 * store 内部状态（`state` 没有挂到 window，故意不暴露）。
 *
 * 文案一律用扩展自己的 `chrome.i18n.getMessage()` 取，脚本里不另抄一份中文
 * ——抄一份就会在改文案时静默失配，测试仍然绿。
 */
import { sleep } from './cdp.mjs';

/** 各门禁的根节点。顺序即 App.vue 的渲染链顺序。 */
export const SELECTORS = {
  boot: '.boot-splash',
  auth: '#authSubmit',
  phrase: '.gate-card',
  bind: '.bg-wrap',
  main: '#syncNow', // popup 主屏；options 页没有它
};

/**
 * 读取当前所处的关卡。
 * @returns {{kind:'boot'|'auth'|'phrase'|'bind'|'main'|'unknown', title:string, cta:string, err:string, text:string}}
 */
export async function readGate(page) {
  const text = await page.text();
  const has = (sel) => page.exists(sel);

  if (await has(SELECTORS.boot)) return { kind: 'boot', title: '', cta: '', err: '', text };
  if (await has(SELECTORS.auth)) return { kind: 'auth', title: '', cta: '', err: '', text };
  if (await has(SELECTORS.phrase)) {
    return {
      kind: 'phrase',
      title: await page.textOf('.gate-title'),
      cta: await page.textOf('.gate-card .btn-primary'),
      err: await page.textOf('.gate-err'),
      text,
    };
  }
  if (await has(SELECTORS.bind)) {
    return {
      kind: 'bind',
      title: await page.textOf('.bg-title'),
      cta: await page.textOf('.bg-actions .btn-primary'),
      err: '',
      text,
    };
  }
  if (await has(SELECTORS.main)) return { kind: 'main', title: '', cta: '', err: '', text };
  return { kind: 'unknown', title: '', cta: '', err: '', text };
}

/**
 * 等门禁到达期望状态。
 *
 * `'unknown'`（页面还没渲染出任何已知关卡，或正在切换的中间态）**永远当作「还没到」**，
 * 即使谓词本身成立也继续等。否则 `waitGate(g => g.kind !== 'boot')` 会在空白页上
 * 立刻返回 'unknown'，后面的登录步骤就全跑在没渲染的页面上（实测：设备 A 整轮
 * `not_authenticated`，因为根本没登录）。
 *
 * @param pred 形如 (g) => g.kind === 'phrase'
 * @returns 最后一次读到的门禁状态（超时也返回，交给调用方断言 —— 不抛异常，
 *          这样报告里能看到「实际停在哪个界面、界面上的文案是什么」）
 */
export async function waitGate(page, pred, timeoutMs = 40_000, intervalMs = 300) {
  const t0 = Date.now();
  let last = await readGate(page);
  while (Date.now() - t0 < timeoutMs) {
    if (last.kind !== 'unknown' && pred(last)) return last;
    await sleep(intervalMs);
    last = await readGate(page);
  }
  return last;
}

/** 在口令门禁页提交口令（输入 + 点 CTA）。 */
export async function submitPhrase(page, phrase) {
  await page.fill('.gate-card input.input', phrase);
  await page.click('.gate-card .btn-primary');
}

/**
 * 登录（AuthView 是门禁链的第一环）。
 * 输入走真实键盘事件（见 Page.fill 的注释），登录按钮有 busy 禁用态，等它解除。
 */
export async function login(page, { email, password }, timeoutMs = 40_000) {
  if (!(await page.waitForSelector('#authSubmit', 20_000))) {
    throw new Error(
      `[${page.name}] 登录页没出现（当前界面: ${(await page.text()).slice(0, 120)}）`,
    );
  }
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('#authSubmit');
  const gate = await waitGate(page, (g) => g.kind !== 'auth' && g.kind !== 'boot', timeoutMs);
  if (gate.kind === 'auth' || gate.kind === 'unknown') {
    throw new Error(
      `[${page.name}] 登录未通过（${gate.kind === 'auth' ? '仍是登录页' : '页面没有渲染出任何已知关卡'}）。` +
        `界面文案: ${gate.text.split('\n').filter(Boolean).slice(0, 6).join(' | ')}`,
    );
  }
  return gate;
}

/** 口令门禁的当前错误文案（`.gate-err`），无错误时返回空串。 */
export async function phraseError(page) {
  return page.textOf('.gate-err');
}
