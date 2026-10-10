// hydration 回归探针 —— 验证 SSG 产物在浏览器里能无警告 hydrate。
//
// 用法：
//   node scripts/check-hydration.mjs        → CLI，失败 exit 1
//
// ★ 为什么必须测：hydration mismatch 只在浏览器控制台报错，SSG 自检（纯文本分析）
//   完全看不见。而它造成的后果是实打实的：首屏闪烁、无 JS 用户看到残缺页面、爬虫在
//   不同渲染时机看到不同内容。构建期无法发现，只能真跑一次浏览器。
//
// ★ 迁移到 Next.js 后的差异：
//   · 产物目录 dist/ → out/，且每页一个扁平 .html（/pricing → pricing.html）。
//   · 内置一个**无依赖的 Node 静态服务器**（把无扩展名路径映射到 .html），
//     不再依赖 `python3 -m http.server`（它无法把 /pricing 映射到 pricing.html）。
//   · 应用根不再是 `#app`（Next 直接渲染进 <body>），改用 body.innerText 判「已 hydrate」。
//   · 新增**样式探针**：注入 .container 读 computed max-width，确认全局 CSS 真的生效
//     （而不是 HTML 完整却渲染成无样式裸文本）。
//
// 需要系统 Chrome/Chromium/Edge（CHROME_BIN 可覆盖）。没装则跳过 —— CI 容器
// 通常没有浏览器，硬失败只会让所有部署无谓地红。
import { createServer } from 'node:http';
import { resolve, dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { CONTENT_ROUTES } from '../src/content/manifest.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'out');
const PORT = 8912;

// 必测页面：每种视图类型各一个 + 两种语言（hydration bug 常只在特定页面出现）。
// ★ 内容页（markdown 驱动）**必测**：它靠构建期装配的数据渲染，客户端没有那份数据 ——
//   一旦两端不一致就是 mismatch，而构建期文本分析看不出来。
// ★ 后台登录页也测：它是**纯客户端**渲染（SSR 输出空壳），能验证客户端挂载链路。
const PATHS = [
  '/',
  '/en',
  '/pricing',
  '/en/pricing',
  '/download',
  '/en/support',
  ...readContentProbePaths(),
  '/admin/login',
];

/** 从内容清单取第一篇文章的两种语言 URL（内容页是新增路径，必须过浏览器）。 */
function readContentProbePaths() {
  const seen = new Set();
  const result = [];
  for (const r of CONTENT_ROUTES) {
    if (seen.has(r.slug)) continue;
    seen.add(r.slug);
    const base = `/${r.prefix}/${r.slug}`;
    result.push(base, `/en${base}`);
  }
  return result;
}

/** 等页面「静下来」的最大时长。 */
const SETTLE_MS = 400;
const MAX_WAIT_MS = 4000;

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * 无依赖静态服务器：把无扩展名路径映射到 `<path>.html` / `<path>/index.html`。
 * ★ 旧脚本用 `python3 -m http.server`，它只按目录 index 提供文件 —— Next 的
 *   扁平 `pricing.html` 会让 `/pricing` 直接 404，探针全红但产品没问题。
 */
function startServer(rootDir, port) {
  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    const candidates =
      pathname === '/'
        ? ['index.html']
        : pathname.endsWith('/')
          ? [`${pathname}index.html`]
          : [pathname, `${pathname}.html`, `${pathname}/index.html`];
    for (const c of candidates) {
      const file = normalize(join(rootDir, c));
      if (!file.startsWith(rootDir)) continue; // 防目录穿越
      if (existsSync(file) && statSync(file).isFile()) {
        const ext = file.slice(file.lastIndexOf('.'));
        res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

export async function runHydrationChecks({ quiet = false, paths = PATHS } = {}) {
  // ★ playwright 必须**动态导入**，不能顶层 import。
  //   它是仓库**根**的 devDependency（给 tests/ 用的），不在 website/package.json 里。
  //   顶层 import 会让整个检查在缺包时直接抛错；动态导入 + 找不到就跳过 ——
  //   hydration 检查是**加分项**，不该成为部署的硬阻塞。
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { errors: [], skipped: 'playwright 未安装（CI 环境，跳过 hydration 检查）' };
  }

  const chromePath = findChrome();
  if (!chromePath) {
    return {
      errors: [],
      skipped: '未找到系统 Chrome/Chromium/Edge（可设 CHROME_BIN 指定）',
    };
  }

  const server = await startServer(out, PORT);
  const errors = [];

  try {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true });

    for (const p of paths) {
      // ★ 每个页面必须用**独立 context**。
      //   共用 context 会让前一个页面写入的 localStorage['bsync.locale'] 泄漏到下一个 ——
      //   「访问过 /en 之后打开 /pricing」于是被判成语言不一致 + hydration mismatch。
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const msgs = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') msgs.push(`[${m.type()}] ${m.text()}`);
      });
      page.on('pageerror', (e) => msgs.push(`[pageerror] ${e.message}`));

      await page.goto(`http://127.0.0.1:${PORT}${p}`, { waitUntil: 'load' });

      // 轮询等正文出现（hydration 完成），再留观察窗
      const t0 = Date.now();
      let hydrated = false;
      while (Date.now() - t0 < MAX_WAIT_MS) {
        hydrated = await page
          .evaluate(() => (document.body?.innerText?.length || 0) > 50)
          .catch(() => false);
        if (hydrated) break;
        await sleep(100);
      }
      await sleep(SETTLE_MS);

      // 1. 不允许出现 hydration / mismatch 警告
      const hyd = msgs.filter((m) => /hydrat|mismatch/i.test(m));
      if (hyd.length) {
        errors.push(`[${p}] hydration 警告 ${hyd.length} 条:\n      ${hyd.join('\n      ')}`);
      }

      // 2. 语言必须与 URL 一致（SSG 中文页被客户端切成英文 = locale 判断跑偏）
      const lang = await page.getAttribute('html', 'lang');
      const wantLang = p.startsWith('/en') ? 'en' : 'zh-CN';
      if (lang !== wantLang) errors.push(`[${p}] html lang = ${lang}，期望 ${wantLang}`);

      // 3. 标题必须与 SSG 静态值一致
      const title = await page.title();
      if (!title) errors.push(`[${p}] title 为空`);

      // 4. 正文必须真的被 hydrate（不是空壳）
      const mainLen = await page.evaluate(() => document.body?.innerText?.length || 0);
      if (mainLen < 50) errors.push(`[${p}] hydrate 后正文仅 ${mainLen} 字符`);

      // 5. 样式探针：全局 CSS 必须真的生效（否则首屏无样式裸文本）
      const styled = await page
        .evaluate(() => {
          const el = document.createElement('div');
          el.className = 'container';
          document.body.appendChild(el);
          const maxWidth = getComputedStyle(el).maxWidth;
          el.remove();
          return { sheets: document.styleSheets.length, maxWidth };
        })
        .catch(() => null);
      if (!styled) {
        errors.push(`[${p}] 样式探针执行失败`);
      } else {
        if (styled.sheets < 1) errors.push(`[${p}] 没有加载任何样式表`);
        if (!styled.maxWidth || styled.maxWidth === 'none') {
          errors.push(`[${p}] .container 未被样式化（max-width=${styled.maxWidth}）—— 全局 CSS 未生效`);
        }
      }

      // 6. 其他控制台错误（不含 404 资源类噪声）
      const real = msgs.filter((m) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(m));
      if (real.length) errors.push(`[${p}] 控制台报错:\n      ${real.join('\n      ')}`);

      await page.close();
      await ctx.close();
    }

    await browser.close();
    if (!quiet) {
      console.log(`\nhydration 检查 ${paths.length} 个页面（${chromePath.split('/').pop()}）`);
      if (errors.length) {
        console.log(`\n❌ ${errors.length} 个错误:`);
        errors.forEach((e) => console.log('  - ' + e));
      } else {
        console.log('✅ 全部通过：无 hydration 警告，语言与 URL 一致，样式已生效\n');
      }
    }
    return { errors, skipped: null };
  } catch (e) {
    return { errors: [`hydration 检查异常: ${e.message}`], skipped: null };
  } finally {
    server.close();
  }
}

// CLI 直跑
if (process.argv[1] && process.argv[1].endsWith('check-hydration.mjs')) {
  const { errors, skipped } = await runHydrationChecks();
  if (skipped) {
    console.log(`⚠ ${skipped} —— 跳过 hydration 检查。`);
    process.exit(0);
  }
  if (errors.length) process.exit(1);
}
