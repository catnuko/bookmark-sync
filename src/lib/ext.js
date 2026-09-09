// 浏览器扩展 API 注入（Chrome 的 chrome.* 与 Safari 的 browser.*）
export const api = globalThis.chrome ?? globalThis.browser;