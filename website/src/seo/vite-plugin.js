/**
 * Vite 插件：构建后生成 sitemap.xml / robots.txt，并对全部公开路由做 SSG 预渲染。
 *
 * 三件事：
 *   1. sitemap.xml —— 7 页 × 2 语言 = 14 条 URL，hreflang 指向**真实不同**的 URL。
 *      ★ 之前 zh-CN 与 en 指向同一个 URL（locale 靠 localStorage 切换，没有独立 URL），
 *        Google 只会索引其中一种语言，另一版被判重复。现在改为 /en/* 独立路径。
 *   2. robots.txt —— 禁 /admin（后台），指sitemap。
 *   3. SSG —— 每个 URL 渲染出独立 HTML（含正文 + meta + JSON-LD），并生成 404.html。
 *
 * 路由清单直接 import src/router/routes.js，不手抄 —— 手抄必然漏 /support（真发生过）。
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vue from '@vitejs/plugin-vue';

const SITE_URL = 'https://www.bookmark-sync.top';
const LOCALES = ['zh', 'en'];
const HREFLANG = { zh: 'zh-CN', en: 'en' };

/** 与 sitemap 一致的 URL → 路径。/ 映射到 index.html。 */
function outputFileFor(urlPath) {
  if (urlPath === '/') return 'index.html';
  return `${urlPath.replace(/^\//, '')}/index.html`;
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * ★ lastmod 用「内容真实最后更新日」（src/lib/site-meta.js 的 SITE_UPDATED），
 *   **不要**用构建日期。用构建日期的后果：每次 CI 构建都声称 14 个 URL 全部更新，
 *   而内容根本没变 → Google 会判定 sitemap 不可信并整体降权（比不写 lastmod 更糟）。
 *   真要按页粒度追踪，就把 lastmod 挪到路由表里逐页维护。
 */
function buildSitemap(routes, localizedPath, lastmod) {
  const entries = [];

  for (const r of routes) {
    for (const loc of LOCALES) {
      const urlPath = localizedPath(r.path, loc);
      const alternates = LOCALES.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${SITE_URL}${localizedPath(r.path, l)}"/>`,
      ).join('\n');
      entries.push(
        `  <url>
    <loc>${SITE_URL}${urlPath}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${localizedPath(r.path, 'zh')}"/>
  </url>`,
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

function buildRobots() {
  return `# robots.txt for ${SITE_URL}
User-agent: *
Allow: /
Disallow: /admin

# Sitemap
Sitemap: ${SITE_URL}/sitemap.xml
`;
}

/**
 * 把 vite 构建出的 index.html 模板替换成预渲染页。
 *
 * ★ 用 `<div id="seo-default">…</div>` 作为标记，**不能**用 HTML 注释 ——
 *   vite 构建时会剥离注释，注释标记在产物里不存在，正则匹配不到，
 *   旧 meta 块会残留在每页里造成重复 title（爬虫取哪个不确定 = SEO 失效）。
 *   这个坑真踩过一次。
 *
 * 1. 用渲染出的 head 片段替换 <div id="seo-default"> 整块（连带 div 自身一起去掉）
 * 2. <html> 开标签合并渲染出的 htmlAttrs（lang 必须正确，否则搜索引擎判语言错）
 * 3. 正文填入 <div id="app">
 */
function injectIntoTemplate(template, { html, head, htmlAttrs }) {
  const start = template.indexOf('<div id="seo-default">');
  if (start === -1) {
    throw new Error('SSG 失败：dist/index.html 里找不到 <div id="seo-default"> 标记');
  }
  // 匹配到对应的 </div>（块内无嵌套 div，用惰性匹配即可）
  const endTag = '</div>';
  const end = template.indexOf(endTag, start);
  if (end === -1) {
    throw new Error('SSG 失败：<div id="seo-default"> 没有闭合');
  }

  let out =
    template.slice(0, start) +
    `<!--seo-default-->\n    ${head}\n    <!--/seo-default-->` +
    template.slice(end + endTag.length);

  // <html> 开标签：渲染出的 htmlAttrs 自带前导空格，后面必须补 '>'。
  out = out.replace(/<html[^>]*>/, () => `<html${htmlAttrs || ' lang="zh-CN"'}>`);

  out = out.replace('<div id="app"></div>', () => `<div id="app">${html}</div>`);

  return out;
}

export function seoStaticPlugin() {
  let isBuild = false;
  return {
    name: 'seo-static',
    apply: 'build',

    configResolved() {
      isBuild = true;
    },

    async closeBundle() {
      const root = process.cwd();
      const distDir = resolve(root, 'dist');
      mkdirSync(distDir, { recursive: true });

      // ── SSG 预渲染 ──────────────────────────────────────────────────────
      // ★ 一律走 vite 的 ssrLoadModule 加载源码：routes.js 顶层 import 了 .vue
      //   （NotFoundView），Node 直接 import 会报 ERR_UNKNOWN_FILE_EXTENSION。
      const { createServer } = await import('vite');
      // 模板在**写任何产物之前**读一次并留在内存里。
      // ★ 不能边渲染边从 dist/index.html 读：首页的输出路径就是 dist/index.html，
      //   第一页写完之后模板已被替换掉，后续页面会拿到「渲染结果」当模板，
      //   结果是 meta 重复 + 套娃（真踩过）。
      const template = readFileSync(resolve(distDir, 'index.html'), 'utf8');
      if (!template.includes('<div id="seo-default">')) {
        this.error(
          'dist/index.html 里找不到 <div id="seo-default"> 标记 —— SSG 注入会失效。' +
            '通常是 src/index.html 被改坏，构建产物已不是预期模板。',
        );
      }

      const server = await createServer({
        root,
        configFile: false,
        appType: 'custom',
        logLevel: 'error',
        server: { middlewareMode: true },
        plugins: [vue()],
      });

      try {
        const routesMod = await server.ssrLoadModule('/src/router/routes.js');
        const { PUBLIC_ROUTES, pathForLocale } = routesMod;
        const { renderPage } = await server.ssrLoadModule('/src/seo/ssg.js');
        const i18nMod = await server.ssrLoadModule('/src/i18n/index.js');
        const faqMod = await server.ssrLoadModule('/src/seo/faq.js');
        const configMod = await server.ssrLoadModule('/src/seo/config.js');
        const { SITE_UPDATED } = await server.ssrLoadModule('/src/lib/site-meta.js');

        const sitemapRoutes = PUBLIC_ROUTES.map((r) => ({
          path: r.path,
          priority: r.path === '/' ? '1.0' : ['pricing', 'download'].includes(r.seoKey) ? '0.8' : '0.5',
          changefreq: r.path === '/' ? 'weekly' : ['pricing', 'download'].includes(r.seoKey) ? 'monthly' : 'yearly',
        }));
        writeFileSync(resolve(distDir, 'sitemap.xml'), buildSitemap(sitemapRoutes, pathForLocale, SITE_UPDATED), 'utf8');
        writeFileSync(resolve(distDir, 'robots.txt'), buildRobots(), 'utf8');

        const messages = i18nMod.messages;

        // FAQPage JSON-LD：按 seoKey 决定用哪组 key，与页面组件保持一致
        const faqFor = {
          home: { ns: 'pricing.faq.items', keys: faqMod.PRICING_FAQ_KEYS },
          pricing: { ns: 'pricing.faq.items', keys: faqMod.PRICING_FAQ_KEYS },
          support: { ns: 'support.faq.items', keys: faqMod.SUPPORT_FAQ_KEYS },
        };

        const targets = [];
        for (const r of PUBLIC_ROUTES) {
          for (const loc of LOCALES) {
            targets.push({ seoKey: r.seoKey, urlPath: pathForLocale(r.path, loc), locale: loc });
          }
        }
        // 404 页（noindex，不进 sitemap）。
        // ★ outPath 是相对 dist 的**文件名**（'404.html' / 'en/404.html'），
        //   urlPath 是喂给 renderPage 的**路由路径**（'/404'），两者不是一回事。
        //   混用会写出到 dist 之外（EROFS）—— 之前真踩过。
        targets.push({ seoKey: 'notFound', routePath: '/404', outFile: '404.html', locale: 'zh' });
        targets.push({ seoKey: 'notFound', routePath: '/en/404', outFile: 'en/404.html', locale: 'en' });

        let done = 0;
        for (const t of targets) {
          const routePath = t.routePath || t.urlPath;
          const jsonLd = [];
          const f = faqFor[t.seoKey];
          if (f) {
            const items = faqMod.pickFaqItems(messages[t.locale], f.ns, f.keys);
            if (items.length) {
              jsonLd.push(configMod.getFaqJsonLd(items, `${SITE_URL}${t.urlPath}`));
            }
          }

          const page = await renderPage(routePath, { jsonLd });
          const out = injectIntoTemplate(template, page);
          // 公开页写成 <path>/index.html（Vercel / Cloudflare Pages 均按目录 index 提供无扩展名 URL）
          const outFile = t.outFile || outputFileFor(t.urlPath);
          const outPath = resolve(distDir, outFile);
          mkdirSync(dirname(outPath), { recursive: true });
          writeFileSync(outPath, out, 'utf8');
          done += 1;
          console.log(`[ssg] ${routePath} → ${outFile}  (${page.html.length}B html)`);
        }
        console.log(`[ssg] ${done} pages prerendered`);
      } finally {
        await server.close();
      }

      console.log('[seo-static] sitemap.xml + robots.txt + SSG pages generated in dist/');

      // ── 构建末尾自检（失败即抛错，让 CI/Vercel 红）──────────────────────
      // ★ 两道闸，缺一不可：
      //   1. check-ssg.mjs       —— 纯文本分析产物：title/canonical/hreflang/robots/
      //      JSON-LD/正文。抓「写错了」这类问题。
      //   2. check-hydration.mjs —— 真浏览器跑一遍。抓「构建期看不出来」的问题：
      //      hydration mismatch、客户端改掉语言/标题、首屏空壳。
      //   SEO 出错的共同点：**不会抛异常**，构建照样绿，只有爬虫/用户能发现。
      const { runChecks } = await import(resolve(root, 'scripts/check-ssg.mjs'));
      const { errors } = runChecks({ quiet: true });
      for (const e of errors) console.error(`[ssg-check] ❌ ${e}`);
      if (errors.length) {
        throw new Error(`SSG 自检未通过：${errors.length} 个错误（见上）。修好再发版。`);
      }
      console.log('[ssg-check] ✅ 产物 SEO meta 自检通过');

      // hydration 检查需要系统浏览器；没装就跳过（脚本自己判定）。
      // 不硬失败：CI 容器通常没 Chrome，硬失败会让所有部署无谓地红。
      const { runHydrationChecks } = await import(resolve(root, 'scripts/check-hydration.mjs'));
      const hyd = await runHydrationChecks({ quiet: true });
      for (const e of hyd.errors) console.error(`[hydr-check] ❌ ${e}`);
      if (hyd.skipped) {
        console.log(`[hydr-check] ⏭ 跳过：${hyd.skipped}`);
      } else if (hyd.errors.length) {
        throw new Error(
          `hydration 自检未通过：${hyd.errors.length} 个错误（见上）。` +
            '这会造成首屏闪烁、无 JS 用户看到残缺页面 —— 修好再发版。',
        );
      } else {
        console.log('[hydr-check] ✅ 无 hydration mismatch');
      }
    },
  };
}