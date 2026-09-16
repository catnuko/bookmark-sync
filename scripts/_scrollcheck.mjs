// 校验：弹窗固定高度 600、顶栏常驻、内容区自滚动、滚动条样式统一。
import { chromium } from "playwright";

const BASE = "http://localhost:5199/preview.html";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 760 } });
const out = {};

async function go(view) {
  await page.goto(`${BASE}?view=${view}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
}

await go("popup");
out.popup = await page.evaluate(() => {
  const root = document.querySelector(".popup-root");
  const chrome = document.querySelector(".popup-chrome");
  const body = document.querySelector(".popup-body");
  const cs = body ? getComputedStyle(body) : null;
  return {
    rootH: root ? Math.round(root.getBoundingClientRect().height) : null,
    chromeH: chrome ? Math.round(chrome.getBoundingClientRect().height) : null,
    bodyH: body ? Math.round(body.getBoundingClientRect().height) : null,
    bodyOverflowY: cs ? cs.overflowY : null,
    bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
  };
});

await go("key");
out.key = await page.evaluate(() => {
  const body = document.querySelector(".drawer-body");
  const cs = body ? getComputedStyle(body) : null;
  return {
    bodyOverflowY: cs ? cs.overflowY : null,
    scrollH: body ? body.scrollHeight : null,
    clientH: body ? body.clientHeight : null,
    scrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
  };
});

await go("auth");
out.auth = await page.evaluate(() => {
  const body = document.querySelector(".auth-body");
  const root = document.querySelector(".auth-view");
  return {
    rootH: root ? Math.round(root.getBoundingClientRect().height) : null,
    bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
  };
});

// 统一滚动条：验证全局伪元素规则已生效（通过 CSSOM 匹配规则存在性近似判断）
out.scrollbarRule = await page.evaluate(() => {
  let found = null;
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules || []) {
      if (r.selectorText === "::-webkit-scrollbar") found = r.style.cssText;
    }
  }
  return found;
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
