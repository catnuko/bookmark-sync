import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const outDir = '.workbuddy/design/_shots';
mkdirSync(outDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const page = await browser.newPage({
  deviceScaleFactor: 2,
  viewport: { width: 1040, height: 900 },
});
await page.goto('http://localhost:5199/preview.html?view=options&pane=crypto', {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(500);
const el = await page.$('#app');
await (el ?? page).screenshot({ path: `${outDir}/options-crypto-key.png` });
console.log('shot options-crypto-key');
await browser.close();
