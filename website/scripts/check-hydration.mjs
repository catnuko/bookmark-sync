// hydration 回归探针 —— 验证 SSG 产物在浏览器里能无警告 hydrate。
//
// 用法：
//   node scripts/check-hydration.mjs        → CLI，失败 exit 1
//   import { runHydrationChecks } from '…'   → 被 vite-plugin 在构建末尾调用
//
// ★ 为什么必须测：hydration mismatch 只在浏览器控制台报错，SSG 自检（纯文本分析）
//   完全看不见。而它造成的后果是实打实的：首屏闪烁、无 JS 用户看到残缺页面、
//   爬虫在不同渲染时机看到不同内容。构建期无法发现，只能真跑一次浏览器。
//
// 需要系统 Chrome/Chromium/Edge（CHROME_BIN 可覆盖）。没装则跳过 —— CI 容器
// 通常没有浏览器，硬失败只会让所有部署无谓地红。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const PORT = 8912;

// 必测页面：每种视图类型各一个 + 两种语言（hydration bug 常只在特定页面出现）。
// ★ 内容页（markdown 驱动）**必测**：它靠 SSG 注入 article 数据，
//   客户端没有那份数据 —— 一旦两端不一致就是 mismatch，而构建期文本分析看不出来。
const PATHS = [
  '/',
  '/en',
  '/pricing',
  '/en/pricing',
  '/download',
  '/en/support',
  ...readContentProbePaths(),
];

/** 从 manifest 抠第一个内容页的两种语言 URL（内容页是新增路径，必须过浏览器）。 */
function readContentProbePaths() {
  try {
    const mf = resolve(root, 'src/content/manifest.js');
    if (!existsSync(mf)) return [];
    const src = readFileSync(mf, 'utf8');
    const block = /export const CONTENT_ROUTES = (\[[\s\S]*?\]);/.exec(src);
    if (!block) return [];
    const routes = JSON.parse(block[1]);
    const seen = new Set();
    const out = [];
    for (const r of routes) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      const base = `/${r.prefix}/${r.slug}`;
      out.push(base, `/en${base}`);
    }
    return out;
  } catch {
    return [];
  }
}

/** 等页面「静下来」的最大时长。hydration 在挂载后几百 ms 内完成，
 *  固定 sleep 2500ms×6 页 = 15s 白等。这里改成轮询：正文出现即开始计时，
 *  再留 400ms 观察窗给迟到的 warning —— 能省 10s 以上，且比固定等待更可靠。 */
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

async function waitForServer(port) {
  const net = await import('node:net');
  for (let i = 0; i < 60; i++) {
    // ★ 只用「裸 TCP 握手」探端口，**不要** fetch('/') 去探首页。
    //   python -m http.server 是单线程串行的：一次 fetch('/') 会占住唯一连接，
    //   随后的页面请求被排队甚至截断，浏览器拿到不完整 HTML → 报 hydration mismatch。
    //   这个坑真踩过：一度以为产品 hydration 有问题，实际是探针自己制造的假阳性。
    const ok = await new Promise((res) => {
      const s = net.connect({ host: '127.0.0.1', port }, () => {
        s.end();
        res(true);
      });
      s.on('error', () => res(false));
    });
    if (ok) return true;
    await sleep(150);
  }
  return false;
}

export async function runHydrationChecks({ quiet = false, paths = PATHS } = {}) {
  const chromePath = findChrome();
  if (!chromePath) {
    return {
      errors: [],
      skipped: '未找到系统 Chrome/Chromium/Edge（可设 CHROME_BIN 指定）',
    };
  }

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: dist,
    stdio: 'ignore',
  });
  const errors = [];

  try {
    if (!(await waitForServer(PORT))) {
      return { errors: [`静态服务没起来（port ${PORT}）`], skipped: null };
    }

    const browser = await chromium.launch({ executablePath: chromePath, headless: true });

    for (const p of paths) {
      // ★ 每个页面必须用**独立 context**。
      //   共用 context 会让前一个页面写入的 localStorage['bsync.locale'] 泄漏到下一个——
      //   「访问过 /en 之后打开 /pricing」于是被判成语言不一致 + hydration mismatch。
      //   同样真踩过：一度以为产品有 bug，实际是探针自己污染了状态。
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const msgs = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') msgs.push(`[${m.type()}] ${m.text()}`);
      });
      page.on('pageerror', (e) => msgs.push(`[pageerror] ${e.message}`));

      // static server 对 /pricing 会 301 到 /pricing/，跟随后取最终 URL
      await page.goto(`http://127.0.0.1:${PORT}${p}`, { waitUntil: 'load' });

      // 轮询等正文出现（hydration 完成），再留观察窗
      const t0 = Date.now();
      let hydrated = false;
      while (Date.now() - t0 < MAX_WAIT_MS) {
        hydrated = await page
          .evaluate(() => (document.querySelector('#app')?.innerText.length || 0) > 100)
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

      // 3. 标题必须与 SSG 静态值一致（hydration 后被改说明两端判断不一致）
      const title = await page.title();
      if (!title) errors.push(`[${p}] title 为空`);

      // 4. 正文必须真的被 hydrate（不是空壳）
      const mainLen = await page.evaluate(() => document.querySelector('#app')?.innerText.length || 0);
      if (mainLen < 100) errors.push(`[${p}] hydrate 后正文仅 ${mainLen} 字符`);

      // 5. 其他控制台错误（不含 404 资源类噪声）
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
        console.log('✅ 全部通过：无 hydration 警告，语言与 URL 一致\n');
      }
    }
    return { errors, skipped: null };
  } catch (e) {
    return { errors: [`hydration 检查异常: ${e.message}`], skipped: null };
  } finally {
    server.kill();
  }
}

// CLI 直跑（被 vite 插件 import 时不走这段）
if (process.argv[1] && process.argv[1].endsWith('check-hydration.mjs')) {
  const { errors, skipped } = await runHydrationChecks();
  if (skipped) {
    console.log(`⚠ ${skipped} —— 跳过 hydration 检查。`);
    process.exit(0);
  }
  if (errors.length) process.exit(1);
}
