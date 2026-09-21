// 开发用：把 preview.html 的各视图截图到 .workbuddy/design/_shots/，用于对照设计稿验收。
// 用法：先 `npx vite --port 5199 --strictPort`，再 `node scripts/_preview-shot.mjs`
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.env.BASE || 'http://localhost:5199';
const outDir = '.workbuddy/design/_shots';
mkdirSync(outDir, { recursive: true });

const targets = process.env.ONLY
  ? [[process.env.ONLY, `/preview.html?view=${process.env.ONLY}`]]
  : [
      ['popup', '/preview.html?view=popup'],
      ['key', '/preview.html?view=key'],
      ['spaces', '/preview.html?view=spaces'],
      ['auth', '/preview.html?view=auth'],
      ['options-sync', '/preview.html?view=options&pane=sync'],
      ['options-spaces', '/preview.html?view=options&pane=spaces'],
      ['options-crypto', '/preview.html?view=options&pane=crypto'],
      ['options-account', '/preview.html?view=options&pane=account'],
      ['options-advanced', '/preview.html?view=options&pane=advanced'],
      ['options-help', '/preview.html?view=options&pane=help'],
    ];

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}

const page = await browser.newPage({
  deviceScaleFactor: 2,
  viewport: { width: 1100, height: 900 },
});
for (const [name, path] of targets) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const el = await page.$('#app');
  await (el ?? page).screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
