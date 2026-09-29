// 生成 Creem 产品封面用的「定价图」（英文）：
//   dist/creem-pricing-cover-plus.png  ← 带「Recommended」徽标（Plus 产品页用）
//   dist/creem-pricing-cover-pro.png   ← 去掉徽标（Pro 产品页用，免得在 Pro 页反向推销更便宜的 Plus）
//
// 做法：渲染官网定价页的英文版，截 .pricing-hero；1920 视口 @2x = 3840×2000。
// 产物不进仓库（dist/ 已 gitignore），需要时上传到 Creem 后台的产品表单。
//
// 用法：node scripts/make-pricing-cover.mjs
//   PRICING_URL  覆盖渲染目标。默认线上 https://www.bookmark-sync.top/pricing；
//                改版前想先看效果可传本地预览，如 http://localhost:4173/pricing
//   CHROME_BIN   覆盖 Chrome 可执行文件；默认走 Playwright 的 channel: 'chrome'
//
// 为什么不用 Safari MCP 截图：它回传 base64、落不了盘，而 Creem 上传要磁盘上的文件。
// 为什么默认 channel: 'chrome'：本机没装 Playwright 自带的 chromium。
import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';

const URL = process.env.PRICING_URL || 'https://www.bookmark-sync.top/pricing';
const OUT_DIR = 'dist';
const VIEWPORT = { width: 1920, height: 1200 };
const DPR = 2;

// 站点语言是纯客户端 localStorage（没有 URL 参数），必须在页面脚本执行前塞进去。
const FORCE_EN = () => localStorage.setItem('bsync.locale', 'en');

// 官网 .section-subtitle 限宽 540px，1920 视口下会把 "true-tree" 断成 "true-" / "tree"。
// 放宽到 760px；除此之外完全照官网原样渲染。
const BASE_CSS = '.section-subtitle{max-width:760px}';
const HIDE_BADGE_CSS = '.plan-badge{display:none!important}';

const VARIANTS = [
  { name: 'plus', css: BASE_CSS, note: '带 Recommended 徽标' },
  { name: 'pro', css: BASE_CSS + HIDE_BADGE_CSS, note: '去掉 Recommended 徽标' },
];

mkdirSync(OUT_DIR, { recursive: true });

const launchOpts = { args: ['--lang=en-US', '--hide-scrollbars'] };
if (process.env.CHROME_BIN) launchOpts.executablePath = process.env.CHROME_BIN;
else launchOpts.channel = 'chrome';

const browser = await chromium.launch(launchOpts);
try {
  for (const { name, css, note } of VARIANTS) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DPR,
      locale: 'en-US',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    await ctx.addInitScript(FORCE_EN);

    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForSelector('.plans-grid .plan-card', { timeout: 20_000 });

    // 防御：语言注入失败或官网改版时，别静默产出一张中文图或半张图。
    const cards = await page.locator('.plans-grid .plan-card').count();
    if (cards !== 3) {
      throw new Error(`预期 3 张定价卡片，实际 ${cards} 张 —— 官网结构变了？`);
    }
    const plusPrice = (
      await page.textContent('.plans-grid .plan-card:nth-child(2) .plan-price')
    )?.trim();
    if (plusPrice !== '$20') {
      throw new Error(`Plus 价格读到 "${plusPrice}"（预期 $20）—— 语言没切到英文，或官网改版`);
    }

    await page.addStyleTag({ content: css });
    await page.waitForTimeout(400); // 等字体/过渡收尾

    const el = page.locator('.pricing-hero');
    const box = await el.boundingBox();
    const out = `${OUT_DIR}/creem-pricing-cover-${name}.png`;
    await el.screenshot({ path: out });

    const px = `${Math.round(box.width * DPR)}×${Math.round(box.height * DPR)}`;
    console.log(
      `[pricing-cover] ${out} (${px}, ${(statSync(out).size / 1024).toFixed(0)} KB) — ${note}`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}
