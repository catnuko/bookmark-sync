// 视觉验收：对照设计稿断言 5 项修复是否落实（模型无法读图，用 DOM 文本/结构断言代替肉眼）。
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199/preview.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
const out = {};

async function go(view) {
  await page.goto(`${BASE}?view=${view}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

// ---- 主弹窗：#1 hover 整条高亮(宽度撑满) + #2 顶部软件名 ----
await go('popup');
out.popup = await page.evaluate(() => {
  const chrome = document.querySelector('.popup-chrome');
  const rows = [...document.querySelectorAll('.inset-row')];
  const group = document.querySelector('.inset-group');
  const rowW = rows[0] ? rows[0].getBoundingClientRect().width : 0;
  const grpW = group ? group.getBoundingClientRect().width : 0;
  const keyRow = rows.find((r) => r.textContent.includes('同步密钥'));
  const badge = keyRow ? keyRow.querySelector('.badge') : null;
  return {
    hasChrome: !!chrome,
    chromeName: chrome ? chrome.querySelector('.ext-name')?.textContent : null,
    rowCount: rows.length,
    rowFillsGroup: Math.abs(rowW - grpW) < 1,
    keyBadgeText: badge ? badge.textContent.trim() : null,
    keyBadgeOnRight: badge
      ? (() => {
          const r = keyRow.getBoundingClientRect();
          const b = badge.getBoundingClientRect();
          return b.left > r.left + r.width * 0.55;
        })()
      : false,
  };
});

// ---- 认证屏：#2 顶部软件名 + #3 高度/密排(标题+字段标签+忘记密码脚) ----
await go('auth');
out.auth = await page.evaluate(() => {
  const chrome = document.querySelector('.popup-chrome');
  const h1 = document.querySelector('.auth-brand h1');
  const labels = [...document.querySelectorAll('.field > label')].map((l) => l.textContent.trim());
  const footFirst = document.querySelector('.popup-foot .link-btn');
  return {
    hasChrome: !!chrome,
    chromeName: chrome ? chrome.querySelector('.ext-name')?.textContent : null,
    title: h1 ? h1.textContent.trim() : null,
    fieldLabels: labels,
    footFirst: footFirst ? footFirst.textContent.trim() : null,
  };
});

// ---- 同步密钥抽屉：#4 去掉灰色外框 + #5 警告文案对齐 ----
await go('key');
out.key = await page.evaluate(() => {
  const blocks = document.querySelectorAll('.kp-block').length;
  const insetGroups = document.querySelectorAll(
    '.kp-block .inset-group, .inset-group .inset-row',
  ).length;
  const danger = document.querySelector('.banner-danger');
  const keyBox = document.querySelector('.key-box');
  return {
    kpBlockCount: blocks,
    grayFramesInsideKey: insetGroups, // 应为 0
    dangerText: danger ? danger.textContent.replace(/\s+/g, ' ').trim() : null,
    hasKeyBox: !!keyBox,
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
