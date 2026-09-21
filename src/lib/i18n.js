// i18n — chrome.i18n 轻量包装
// 语言跟随浏览器 UI 语言（Chrome / Edge / Firefox 一致行为）：
// _locales/zh_CN 命中中文浏览器，其余回落 default_locale（en）。
// 见 https://developer.chrome.com/docs/extensions/reference/api/i18n
//
// 消息键与文案定义在 public/_locales/<locale>/messages.json（构建时拷入产物根目录）。

const cache = new Map();

/**
 * 取本地化文案。
 * @param {string} key 消息键（见 _locales 语言目录下的 messages.json）
 * @param {...(string|number)} subs 占位符实参，按 $1、$2… 顺序代入
 * @returns {string}
 */
export function t(key, ...subs) {
  const cacheKey = subs.length ? `${key}\u0001${subs.join('\u0001')}` : key;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  let msg = globalThis.chrome?.i18n?.getMessage(key, subs.map(String)) ?? '';
  if (!msg) msg = key; // 缺键时显式暴露键名，便于发现漏配
  cache.set(cacheKey, msg);
  return msg;
}

/** 浏览器 UI 语言（如 "zh-CN" / "en-US"），用于设置 document.documentElement.lang */
export function uiLanguage() {
  return globalThis.chrome?.i18n?.getUILanguage?.() ?? 'en';
}
