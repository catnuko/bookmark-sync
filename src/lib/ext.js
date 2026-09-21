// 浏览器扩展 API 注入
// 优先 browser.*（Firefox / Safari / Chrome 148+ / Edge 136+ 均为 Promise 风格），
// 旧版 Chrome/Edge 无 browser 时回退到 chrome.*（MV3 同样返回 Promise）。
export const api = globalThis.browser ?? globalThis.chrome;
