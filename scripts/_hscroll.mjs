import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 820 } });
const sel = { popup: ".popup-body", key: ".drawer-body", spaces: ".drawer-body", auth: ".auth-body" };
const out = {};
for (const [view, s] of Object.entries(sel)) {
  await page.goto(`http://localhost:5199/preview.html?view=${view}&fill=900`, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  out[view] = await page.evaluate((sel) => {
    const h = document.querySelector(sel);
    const cs = getComputedStyle(h);
    const before = { clientW: h.clientWidth, scrollW: h.scrollWidth, overflowX: cs.overflowX };
    // 模拟 Windows 竖直滚动条占位 15px
    h.style.width = h.clientWidth - 15 + "px";
    const after = { clientW: h.clientWidth, scrollW: h.scrollWidth, noHScroll: h.scrollWidth <= h.clientWidth + 1 };
    // 复位，检查是否存在被裁掉的真实内容（即元素宽度 > 容器内容宽）
    h.style.width = "";
    const hr = h.getBoundingClientRect();
    const contentRight = hr.right - parseFloat(cs.paddingRight);
    let clipped = [];
    h.querySelectorAll("*").forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.right > contentRight + 0.5 && el.tagName !== "BUTTON" && !el.className.includes("kp-copy")) {
        clipped.push({ tag: el.tagName, cls: String(el.className).slice(0, 30), over: Math.round(b.right - contentRight) });
      }
    });
    return { before, after, realClipped: clipped.slice(0, 6) };
  }, s);
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
