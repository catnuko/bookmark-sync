import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 760 } });
await page.goto('http://localhost:5199/preview.html?view=key', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const r = await page.evaluate(async () => {
  const body = document.querySelector('.drawer-body');
  // 注入超长内容，强制溢出
  const filler = document.createElement('div');
  filler.style.cssText =
    'height:900px;flex:none;background:linear-gradient(#eee,#ddd);border-radius:10px';
  filler.textContent = 'forced overflow';
  body.appendChild(filler);
  await new Promise((res) => setTimeout(res, 50));
  const before = body.scrollTop;
  const canScroll = body.scrollHeight > body.clientHeight + 1;
  body.scrollTop = 400;
  const after = body.scrollTop;
  return {
    scrollH: body.scrollHeight,
    clientH: body.clientHeight,
    scrollbarThickness: body.offsetWidth - body.clientWidth, // WebKit 自定义滚动条宽度实测值
    canScroll,
    scrolledTo: after,
    movedFromTop: after > before,
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
