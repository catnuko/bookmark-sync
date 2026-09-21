/**
 * e2e/lib/bidi.mjs — 极简 WebDriver BiDi 客户端（Firefox 驱动）。
 *
 * Firefox 无 CDP；geckodriver 0.36 提供 WebDriver BiDi（WebSocket JSON-RPC 2.0）。
 * 本封装只覆盖本项目需要的命令：
 *   browsingContext.create / navigate / getTree
 *   script.evaluate（awaitPromise + 顶层 target 执行）
 *   input.insertText（真实键盘输入，Vue v-model 需要）
 *
 * 约定：evaluate 的表达式返回 JSON.stringify 过的字符串（与现有 popup.mjs
 * 的 eval 用法一致），这样 RemoteValue 反序列化只需取 string value。
 *
 * 用法：
 *   import { Bidi } from './lib/bidi.mjs';
 *   const b = new Bidi(wsUrl);
 *   await b.open();
 *   const ctx = await b.createContext();
 *   await b.navigate(ctx, 'moz-extension://<id>/popup.html');
 *   const { val, err } = await b.evalIn(ctx, 'document.body.innerText');
 */
export class Bidi {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('BiDi WebSocket 连接失败'));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      } else if (m.method) {
        this.events.push(m);
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
  /** 订阅事件（如 browsingContext 相关）。 */
  async subscribe(events) {
    await this.send('session.subscribe', { events });
  }

  // ── browsing context ──────────────────────────────────────────────
  async createContext(type = 'tab') {
    const r = await this.send('browsingContext.create', { type });
    if (r.error)
      throw new Error(`browsingContext.create: ${r.error.message ?? JSON.stringify(r.error)}`);
    return r.result.context;
  }
  async navigate(context, url, wait = 'complete') {
    const r = await this.send('browsingContext.navigate', { context, url, wait });
    if (r.error)
      throw new Error(`browsingContext.navigate: ${r.error.message ?? JSON.stringify(r.error)}`);
    return r.result;
  }
  async getContexts() {
    const r = await this.send('browsingContext.getTree', {});
    if (r.error) throw new Error(`browsingContext.getTree: ${r.error.message}`);
    return r.result.contexts;
  }

  // ── script.evaluate（顶层 target，awaitPromise）───────────────────
  async evalIn(context, expression) {
    const r = await this.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'root',
    });
    if (r.error) {
      return { err: r.error.message ?? JSON.stringify(r.error), val: null, desc: null };
    }
    if (r.result.type === 'exception') {
      const ex = r.result.exceptionDetails ?? {};
      return {
        err: ex.text ?? 'exception',
        val: null,
        desc: ex.exception?.remote?.value ?? JSON.stringify(ex).slice(0, 300),
      };
    }
    return { err: null, val: remoteValue(r.result.result), desc: null };
  }

  // ── input.insertText（作用于当前 focus 元素）─────────────────────
  async insertText(context, text) {
    const r = await this.send('input.insertText', { context, text });
    if (r.error) throw new Error(`input.insertText: ${r.error.message ?? JSON.stringify(r.error)}`);
    return r.result;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
  }
}

/** RemoteValue → JS 值（字符串直取，其余按 type/value 展开）。 */
function remoteValue(v) {
  if (!v || typeof v !== 'object') return v;
  switch (v.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return v.value;
    case 'null':
    case 'undefined':
      return null;
    case 'array':
      return (v.value ?? []).map(remoteValue);
    case 'object':
    case 'map':
      return Object.fromEntries((v.value ?? []).map(([k, val]) => [k, remoteValue(val)]));
    default:
      return v.value ?? null;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
