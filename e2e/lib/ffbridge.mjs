/**
 * e2e/lib/ffbridge.mjs — Firefox 端测试桥调用封装。
 *
 * 原理：e2e/test-bridge 扩展的 content script 把 __testBridge(method, payload)
 * 暴露到页面主世界；WebDriver BiDi 在页面上下文执行该函数，消息经桥扩展后台
 * 转发到 bookmark-sync 扩展的 onMessageExternal 白名单通道。
 *
 * 需要一个真实 http 页面（content script matches <all_urls>，about:blank 不注入）。
 * 本模块内置本地静态服务器返回空白页。
 */
import { createServer } from 'node:http';
import { sleep } from './bidi.mjs';

let serverUrl = null;
let server = null;

export async function startBridgeServer(port = 9455) {
  if (server) return serverUrl;
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body>bridge</body></html>');
  });
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  serverUrl = `http://127.0.0.1:${port}/bridge.html`;
  return serverUrl;
}

export function stopBridgeServer() {
  if (server) { try { server.close(); } catch {} server = null; serverUrl = null; }
}

/** 打开桥页面（content script 已注入），返回 browsing context id。 */
export async function openBridgePage(bidi) {
  const url = serverUrl ?? (await startBridgeServer());
  const ctx = await bidi.createContext('tab');
  await bidi.navigate(ctx, url);
  await sleep(1500);
  // 注入检查：postMessage ping（fail-fast，链路不通早暴露）
  const ping = await bridgeCall(bidi, ctx, 'ping', {});
  if (!ping?.ok) throw new Error(`桥未就绪: ${JSON.stringify(ping)}`);
  return ctx;
}

/** 调用扩展测试通道（postMessage 桥）。返回 { ok, ... } 或抛错。 */
export async function bridgeCall(bidi, ctx, method, payload) {
  const id = `r${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const expr = `(async () => {
    const result = await new Promise((resolve) => {
      const handler = (e) => {
        const d = e.data;
        if (d && d.__bsyncBridge === true && d.__resp === true && d.id === ${JSON.stringify(id)}) {
          window.removeEventListener('message', handler);
          resolve(d.result);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ __bsyncBridge: true, id: ${JSON.stringify(id)}, method: ${JSON.stringify(method)}, payload: ${JSON.stringify(payload ?? {})} }, '*');
    });
    return JSON.stringify(result);
  })()`;
  const r = await bidi.evalIn(ctx, expr);
  if (r.err) throw new Error(`bridge.${method} 执行失败: ${r.err} ${r.desc ?? ''}`);
  try {
    return JSON.parse(r.val);
  } catch (e) {
    throw new Error(`bridge.${method} 返回无法解析: ${String(r.val).slice(0, 200)}`);
  }
}

/** 便捷：等待条件成立（轮询 bridge 读树）。 */
export async function waitFor(bidi, ctx, fn, timeoutMs = 90000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor 超时（${timeoutMs}ms），最后一次结果: ${JSON.stringify(last)?.slice(0, 300)}`);
}
