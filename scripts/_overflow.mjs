import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 800 } });
async function check(view) {
  await page.goto(`http://localhost:5199/preview.html?view=${view}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const host = document.querySelector('.drawer-body, .popup-body, .auth-body');
    if (!host) return null;
    const hr = host.getBoundingClientRect();
    const rows = [];
    host.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      const over = Math.round(r.right - hr.right);
      // 只看超出容器右缘的元素（含 padding 余量）
      if (over > 1 || el.scrollWidth > el.clientWidth + 1) {
        rows.push({
          tag: el.tagName,
          cls: el.className && String(el.className).slice(0, 42),
          rectW: Math.round(r.width),
          overRight: over,
          sw: el.scrollWidth,
          cw: el.clientWidth,
        });
      }
    });
    return {
      host: {
        scrollW: host.scrollWidth,
        clientW: host.clientWidth,
        overflowX: getComputedStyle(host).overflowX,
      },
      offenders: rows.slice(0, 14),
    };
  });
}
console.log('KEY:', JSON.stringify(await check('key'), null, 2));
await browser.close();
