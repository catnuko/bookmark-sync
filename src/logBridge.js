// 日志桥接：将 background SW 的 console.log/warn/error 转发到 options 页面控制台。
// SW 端：monkey-patch console + 环形缓冲区 + 广播 + 响应历史日志请求。
// options 端：启动时拉历史日志 + 监听实时日志。

const MAX_LOGS = 500;
const logBuffer = [];

function serializeArgs(args) {
  return args.map((a) => {
    if (a === undefined) return "undefined";
    if (a === null) return "null";
    if (typeof a === "string") return a;
    if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(" ");
}

function pushLog(level, args) {
  const entry = {
    t: Date.now(),
    level,
    msg: serializeArgs(args),
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) logBuffer.shift();
  // 广播到所有扩展页面（options/popup），不关心是否有人监听
  try {
    chrome.runtime.sendMessage({ type: "bsync-log", entry }).catch(() => {});
  } catch { /* SW 刚启动时 runtime 可能未就绪 */ }
}

/** SW 端安装：替换 console.log/warn/error，所有日志自动转发。 */
export function installLogBridge() {
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args) => { origLog(...args); pushLog("log", args); };
  console.warn = (...args) => { origWarn(...args); pushLog("warn", args); };
  console.error = (...args) => { origError(...args); pushLog("error", args); };

  // 响应 options 页面的历史日志请求
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "bsync-get-logs") {
      sendResponse({ logs: [...logBuffer] });
      return false;
    }
    return false;
  });

  console.log("[logBridge] installed in background SW, buffer size=" + MAX_LOGS);
}

/** options 端启动：拉历史日志 + 监听实时日志，全部打印到当前页面控制台。 */
export function startLogViewer() {
  // 拉历史日志
  chrome.runtime.sendMessage({ type: "bsync-get-logs" }, (resp) => {
    if (resp?.logs?.length) {
      console.log(`[logViewer] === replay ${resp.logs.length} historical logs ===`);
      for (const entry of resp.logs) {
        const ts = new Date(entry.t).toLocaleTimeString();
        const line = `[${ts}] ${entry.msg}`;
        if (entry.level === "error") console.error(line);
        else if (entry.level === "warn") console.warn(line);
        else console.log(line);
      }
    }
  });

  // 监听实时日志
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "bsync-log" && msg.entry) {
      const ts = new Date(msg.entry.t).toLocaleTimeString();
      const line = `[${ts}] ${msg.entry.msg}`;
      if (msg.entry.level === "error") console.error(line);
      else if (msg.entry.level === "warn") console.warn(line);
      else console.log(line);
    }
  });

  console.log("[logViewer] started on options page, waiting for background logs...");
}
