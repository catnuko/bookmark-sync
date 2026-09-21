import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--disable-features=OverlayScrollbar'] });
const page = await browser.newPage({ viewport: { width: 520, height: 760 } });
await page.goto('http://localhost:5199/preview.html?view=key', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const r = await page.evaluate(async () => {
  const body = document.querySelector('.drawer-body');
  const filler = document.createElement('div');
  filler.style.cssText = 'height:900px;flex:none';
  body.appendChild(filler);
  await new Promise((res) => setTimeout(res, 60));
  return {
    scrollbarThickness: body.offsetWidth - body.clientWidth,
    scrollbarWidthProp: getComputedStyle(body).scrollbarWidth,
    scrollbarColorProp: getComputedStyle(body).scrollbarColor,
    canScroll: body.scrollHeight > body.clientHeight + 1,
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
