/**
 * e2e/lib/cdp.mjs — 极简 CDP（Chrome DevTools Protocol）客户端。
 *
 * 依赖 Node 22+ 原生 WebSocket。用法：
 *   import { connect } from './lib/cdp.mjs';
 *   const c = await connect(wsUrl);
 *   await c.send('Runtime.enable');
 *   const { val, err } = await c.eval('1+1');
 */
export class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** 在目标上下文执行表达式（awaitPromise + returnByValue）。 */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result?.exceptionDetails) {
      return {
        err: r.result.exceptionDetails.text,
        val: null,
        desc: r.result.exceptionDetails.exception?.description,
      };
    }
    return { err: null, val: r.result?.result?.value };
  }
  async close() {
    try {
      this.ws.close();
    } catch {}
  }
}

export async function connect(wsUrl) {
  const c = new CDP(wsUrl);
  await c.open();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  return c;
}

/** 轮询等待 CDP 端口就绪并返回 targets。 */
export async function waitForTargets(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await r.json();
      if (targets.length) return targets;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CDP 端口 ${port} 未就绪: ${lastErr}`);
}

/** 轮询等待扩展 SW target 出现（首次加载扩展可能慢于 newtab）。 */
export async function waitForExtensionSw(port, timeoutMs = 45000, expectExtId = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      // 匹配本扩展的 SW：background.js。Edge 内置扩展用 background.rollup.js，
      // 直接取第一个 service_worker 会抓错 id → popup.html ERR_FILE_NOT_FOUND。
      // 传了 expectExtId 时再按 id 收窄（profile 里可能还有别的组件扩展 SW）。
      const sw = targets.find(
        (t) =>
          t.type === 'service_worker' &&
          t.url.startsWith('chrome-extension://') &&
          t.url.includes('/background.js') &&
          (!expectExtId || new URL(t.url).host === expectExtId),
      );
      if (sw) return { extId: new URL(sw.url).host, sw };
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`扩展 SW 未在 ${timeoutMs}ms 内出现（端口 ${port}）`);
}

/** 从 targets 中找 service worker（扩展后台），并解析扩展 id。 */
export function findExtension(targets, extensionIdPrefix = 'chrome-extension://') {
  const sw = targets.find(
    (t) => t.type === 'service_worker' && t.url.startsWith(extensionIdPrefix),
  );
  if (!sw) return { extId: null, sw: null };
  return { extId: new URL(sw.url).host, sw };
}

/** 打开（或复用）扩展页面并返回 CDP 连接。 */
export async function openPage(port, url) {
  const pt = await (
    await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  ).json();
  const page = await connect(pt.webSocketDebuggerUrl);
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
