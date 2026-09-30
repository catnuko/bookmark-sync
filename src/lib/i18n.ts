// i18n — chrome.i18n 轻量包装
// 语言跟随浏览器 UI 语言（Chrome / Edge / Firefox 一致行为），查找链三步：
//   ① 精确命中 _locales/<ui语言>  ② 若带地区，去掉地区再找（zh-TW → zh）
//   ③ 回落 default_locale（en）
// ★ zh_CN 与 zh_TW 是两个**独立代码**，不是同一个中文：繁体用户不会命中 zh_CN。
//   所以 zh_TW/ 是一份**与 zh_CN 内容相同的副本**（繁中用户看到的即简体文案，
//   与官网 detectLocale()「zh* 一律给中文」的行为对齐）。改 zh_CN 文案时 zh_TW 要同步。
// 见 https://developer.chrome.com/docs/extensions/reference/api/i18n
//
// 消息键与文案定义在 public/_locales/<locale>/messages.json（构建时拷入产物根目录）。

interface I18nApi {
  getMessage(key: string, substitutions?: string[]): string;
  getUILanguage(): string;
}

const g = globalThis as typeof globalThis & { chrome?: { i18n?: I18nApi } };

const cache = new Map<string, string>();

/**
 * 取本地化文案。
 * @param key 消息键（见 _locales 语言目录下的 messages.json）
 * @param subs 占位符实参，按 $1、$2… 顺序代入
 * @returns 本地化文案（缺键时原样返回键名）
 */
export function t(key: string, ...subs: Array<string | number>): string {
  const cacheKey = subs.length ? `${key}\u0001${subs.join('\u0001')}` : key;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;
  let msg = g.chrome?.i18n?.getMessage(key, subs.map(String)) ?? '';
  if (!msg) msg = key; // 缺键时显式暴露键名，便于发现漏配
  cache.set(cacheKey, msg);
  return msg;
}

/** 浏览器 UI 语言（如 "zh-CN" / "en-US"），用于设置 document.documentElement.lang */
export function uiLanguage(): string {
  return g.chrome?.i18n?.getUILanguage?.() ?? 'en';
}
