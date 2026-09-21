import { chromium } from 'playwright';
let b;
try {
  b = await chromium.launch({ channel: 'chrome' });
} catch {
  b = await chromium.launch();
}
const p = await b.newPage({ viewport: { width: 900, height: 900 } });
await p.goto('http://localhost:5199/preview.html?view=popup', { waitUntil: 'networkidle' });
await p.waitForTimeout(300);
const out = await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.inset-row')];
  return rows.map((r) => {
    const cs = getComputedStyle(r);
    return {
      rowW: +r.getBoundingClientRect().width.toFixed(1),
      rowDisplay: cs.display,
      rowJustify: cs.justifyContent,
      tag: r.tagName,
      kids: [...r.children].map((k) => {
        const kcs = getComputedStyle(k);
        return {
          tag: k.tagName,
          cls: k.getAttribute('class'),
          display: kcs.display,
          flex: kcs.flex,
          flexGrow: kcs.flexGrow,
          width: +k.getBoundingClientRect().width.toFixed(1),
        };
      }),
    };
  });
});
console.log(JSON.stringify(out, null, 2));
await b.close();
