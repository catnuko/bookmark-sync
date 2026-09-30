// 商店评价入口 —— 三份商店列表、一份代码。
//
// Chrome 与 Edge 共用 `public/manifest.json` 和同一份 JS bundle，构建期区分不了，
// 所以只能在运行时按 UA 判定当前浏览器。判定顺序与 src/sync.ts 的 detectDeviceName()、
// src/sync/chromeBridge.ts 的 IS_FIREFOX 保持一致：**Edg/ 必须排在 Chrome/ 之前**
// （Edge 的 UA 同时含 Chrome/）。
//
// 三个链接 2026-09-30 都实测过：
//   Chrome /reviews  → 直达评价页（会 302 到带 slug 的形态，/reviews 保留）
//   Edge   /reviews  → 被站点忽略并重写回详情页，故用裸链接（Edge 的评价就在详情页里）
//   AMO    /reviews/ → 直达评价页，但 locale 必须按界面语言拼

import { api } from './ext.js';
import { uiLanguage } from './i18n.js';

const CHROME_REVIEWS =
  'https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml/reviews';
const EDGE_LISTING =
  'https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah';

/**
 * 按浏览器 UA + 界面语言，选出「当前浏览器的商店评价页」。
 * @param ua `navigator.userAgent`
 * @param language 浏览器界面语言（`uiLanguage()`，如 "zh-CN" / "en-US"）
 */
export function storeReviewUrl(ua: string, language: string): string {
  if (/Firefox\//.test(ua)) {
    const locale = /^zh/i.test(language) ? 'zh-CN' : 'en-US';
    return `https://addons.mozilla.org/${locale}/firefox/addon/bookmark-sync-app/reviews/`;
  }
  // Edge 的 UA 同时含 Chrome/，必须先判 Edg/
  if (/Edg\//.test(ua)) return EDGE_LISTING;
  // 其余（Chrome / Brave / Vivaldi / Opera…）装的都是 Chrome Web Store 那份包
  return CHROME_REVIEWS;
}

/** 在新标签打开当前浏览器的商店评价页（弹窗随即失焦自动关闭）。 */
export function openStoreReview(): void {
  const url = storeReviewUrl(navigator.userAgent, uiLanguage());
  if (api.tabs?.create) {
    api.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}
