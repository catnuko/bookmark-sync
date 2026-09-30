/**
 * tests/storeLink.test.ts — 商店评价链接的选路契约。
 *
 * 背景：Chrome 与 Edge 共用同一份产物（同一 manifest + 同一 bundle），构建期区分不了，
 * 只能运行时按 UA 判定。最容易被写错的是判定顺序 —— **Edge 的 UA 同时含 `Chrome/`**，
 * 一旦把 `/Chrome\//` 写在 `/Edg\//` 前面，所有 Edge 用户都会被送去 Chrome 商店。
 * 这里把顺序和三个分支都钉死。
 */

import { describe, it, expect } from 'vitest';
import { storeReviewUrl } from '../src/lib/storeLink.js';

const UA = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0',
  opera:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 OPR/115.0.0.0',
};

const CHROME = 'chromewebstore.google.com';
const EDGE = 'microsoftedge.microsoft.com';

describe('storeReviewUrl', () => {
  it('Chrome → Chrome Web Store 评价页', () => {
    const url = storeReviewUrl(UA.chrome, 'en-US');
    expect(url).toContain(CHROME);
    expect(url).toContain('emmjhpmhfepapemiflddnbmikicklfml');
    expect(url).toContain('/reviews');
  });

  it('Edge → Edge 加载项（★ UA 含 Chrome/，不能被判成 Chrome）', () => {
    const url = storeReviewUrl(UA.edge, 'en-US');
    expect(url).toContain(EDGE);
    expect(url).not.toContain(CHROME);
  });

  it('Firefox → AMO，且 locale 跟随界面语言', () => {
    expect(storeReviewUrl(UA.firefox, 'zh-CN')).toContain('/zh-CN/firefox/addon/');
    expect(storeReviewUrl(UA.firefox, 'en-US')).toContain('/en-US/firefox/addon/');
  });

  it('Firefox 的 zh 变体一律归到 zh-CN，其余语言回落 en-US', () => {
    for (const lang of ['zh', 'zh-TW', 'zh-Hans']) {
      expect(storeReviewUrl(UA.firefox, lang)).toContain('/zh-CN/');
    }
    for (const lang of ['ja', 'de', '']) {
      expect(storeReviewUrl(UA.firefox, lang)).toContain('/en-US/');
    }
  });

  it('其它 Chromium 系（Opera/Brave/Vivaldi…）回落 Chrome Web Store', () => {
    expect(storeReviewUrl(UA.opera, 'en-US')).toContain(CHROME);
  });
});
