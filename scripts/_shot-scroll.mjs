import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const outDir = ".workbuddy/design/_shots";
mkdirSync(outDir, { recursive: true });
let browser;
try { browser = await chromium.launch({ channel: "chrome" }); } catch { browser = await chromium.launch(); }
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1100, height: 900 } });
for (const [name, path] of [
  ["popup-fixed", "/preview.html?view=popup"],
  ["key-scroll", "/preview.html?view=key&fill=900"],
  ["spaces-scroll", "/preview.html?view=spaces&fill=700"],
]) {
  await page.goto("http://localhost:5199" + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const el = await page.$("#app");
  await (el ?? page).screenshot({ path: `${outDir}/${name}.png` });
  console.log("shot", name);
}
await browser.close();
