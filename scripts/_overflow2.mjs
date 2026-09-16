import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 800 } });
await page.goto("http://localhost:5199/preview.html?view=key&fill=900", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const host = document.querySelector(".drawer-body");
  const out = {};
  function probe(tag) {
    const hr = host.getBoundingClientRect();
    const cs = getComputedStyle(host);
    const contentRight = hr.right - parseFloat(cs.paddingRight);
    const offenders = [];
    host.querySelectorAll("*").forEach((el) => {
      const b = el.getBoundingClientRect();
      const over = Math.round((b.right - contentRight) * 10) / 10;
      if (over > 0.5) offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 36), over, w: Math.round(b.width) });
      // 自身内容也溢出？
      if (el.scrollWidth > el.clientWidth + 1) offenders.push({ tag: el.tagName, cls: String(el.className).slice(0, 36), selfOver: el.scrollWidth - el.clientWidth });
    });
    out[tag] = {
      clientW: host.clientWidth,
      scrollW: host.scrollWidth,
      overflowX: cs.overflowX,
      offenders: offenders.slice(0, 10),
    };
  }
  probe("natural");
  // 模拟 Windows 上「竖直滚动条占位 15px」的情况
  host.style.width = host.clientWidth - 15 + "px";
  probe("withVScrollbar15");
  return out;
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
