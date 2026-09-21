import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
async function probe(url) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
  await page.goto('http://localhost:5199' + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  return page
    .evaluate(() => {
      const kpKey = document.querySelector('.kp-key');
      const warn = document.querySelector('.kp-block .banner-warning');
      const box = document.querySelector('.kp-key .key-box');
      return {
        keyShown: !!kpKey,
        warningShownInstead: !!warn,
        keyBoxText: box ? box.textContent.trim().slice(0, 12) : null,
        keyBoxLen: box ? box.textContent.trim().length : 0,
      };
    })
    .then((r) => ({ url, ...r }));
}
const out = [
  await probe('/preview.html?view=key'),
  await probe('/preview.html?view=options&pane=crypto'),
];
console.log(JSON.stringify(out, null, 2));
await browser.close();
