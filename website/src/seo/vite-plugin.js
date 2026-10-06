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
// 内容管线：这两个是纯 Node 模块（fs + 字符串），不碰 .vue，可以直接 import。
// 内容页路由清单由 buildStart 生成到 src/content/manifest.js（两端共用同一份）。
import { loadContent, articlePath } from '../content/loader.js';
import { CATEGORIES } from '../content/index.js';

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
 *   **不要**用构建日期。用构建日期的后果：每次 CI 构建都声称所有 URL 全部更新，
 *   而内容根本没变 → Google 会判定 sitemap 不可信并整体降权（比不写 lastmod 更糟）。
 *   真要按页粒度追踪，就把 lastmod 挪到路由表里逐页维护。
 *
 * @param {Array<{basePath: string, priority: string, changefreq: string}>} routes
 *   ★ basePath 必须是**去掉语言前缀**的路径（'/fix/xxx'），两种语言的 URL 由本函数
 *   自己拼。传已带 /en 的路径会被pathForLocale 二次加前缀 → sitemap URL 变成
 *   /en/en/fix/xxx（内容页上线后最典型的自检漏项）。
 * @param {(basePath: string, locale: string) => string} localizedPath
 */
function buildSitemap(routes, localizedPath, lastmod) {
  const entries = [];

  for (const r of routes) {
    for (const loc of LOCALES) {
      const urlPath = localizedPath(r.basePath, loc);
      const alternates = LOCALES.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${SITE_URL}${localizedPath(r.basePath, l)}"/>`,
      ).join('\n');
      entries.push(
        `  <url>
    <loc>${SITE_URL}${urlPath}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${localizedPath(r.basePath, 'zh')}"/>
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

/**
 * 生成 src/content/manifest.js 的源码。
 * 手写这个文件是内容管线最容易出错的地方（漏一篇 → 该页 SSG 渲染成 404），
 * 所以一律生成。
 */
function renderManifest(articles, categories) {
  const routes = articles.map((a) => ({
    locale: a.locale,
    slug: a.slug,
    prefix: categories[a.category]?.prefix || a.category,
    category: a.category,
    // 标题要带上：页脚/索引页要显示它，而那两处在客户端运行（读不到 md 文件）。
    // 没有标题的链接用户点进去才知道是什么，SEO 内部链接也失去描述性。
    title: a.frontmatter.title,
    seoTitle: a.frontmatter.seoTitle,
    description: a.frontmatter.description,
    order: a.order,
  }));
  const catEntries = Object.entries(categories)
    .map(
      ([key, c]) =>
        `  ${key}: {
    prefix: ${JSON.stringify(c.prefix)},
    label: ${JSON.stringify(c.label)},
    description: ${JSON.stringify(c.description)},
  },`,
    )
    .join('\n');

  return `/**
 * 内容清单 —— **构建期自动生成的产物，请勿手改。**
 *
 * 由 src/seo/vite-plugin.js 在 closeBundle 时根据 content/{zh,en}/*.md 重新生成。
 * 为什么要提交进 git 而不是运行时读 fs：
 *   ★ 客户端（CSR）也要import 它来展开路由，而浏览器里没有 fs。
 *   两端必须看到**同一份**路由表，否则 SSR 渲染出的 DOM 与客户端期望的路由不匹配
 *   → hydration 报错或内容页 404。
 *
 * 手改会被下次构建覆盖。要新增文章，改 content/{zh,en}/ 下的 md 即可，
 * 路由 / sitemap / hreflang 会自动跟上。
 */

/** [{ locale, slug, prefix, category }] */
export const CONTENT_ROUTES = ${JSON.stringify(routes, null, 2)};

/** 内容文章的分类定义（与 src/content/index.js 的 CATEGORIES 保持一致）。 */
export const CONTENT_CATEGORIES = {
${catEntries}
};
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

    // manifest 在 buildStart 阶段写好（此时 vite 还没开始本次构建的模块图扫描，
    // 写它不会触发「构建中改了源文件」的自修改循环 —— 在 closeBundle 写会）。
    // ★ 这两个模块是纯 fs/字符串处理，Node 直接 import 没问题（不碰 .vue）。
    buildStart() {
      const root = process.cwd();
      const content = loadContent(resolve(root, 'src/content'));
      writeFileSync(
        resolve(root, 'src/content/manifest.js'),
        renderManifest(content.articles, CATEGORIES),
        'utf8',
      );
      if (content.articles.length) {
        console.log(`[content] ${content.articles.length} 篇已加载，manifest.js 已更新`);
      }
    },

    // ★ 用 writeBundle 而不是 closeBundle：vite 8 / rolldown 下 closeBundle
    //   早于 HTML 落盘（dist/index.html 还不存在），之前能跑通是插件顺序的巧合。
    //   writeBundle 保证在所有产物写完之后执行。
    async writeBundle() {
      const root = process.cwd();
      const distDir = resolve(root, 'dist');
      mkdirSync(distDir, { recursive: true });

      // ── SSG 预渲染 ──────────────────────────────────────────────────────
      // ★ 一律走 vite 的 ssrLoadModule 加载源码：routes.js 顶层 import 了 .vue
      //   （NotFoundView / ContentView），Node 直接 import 会报 ERR_UNKNOWN_FILE_EXTENSION。
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

        // ── 内容路由清单在 buildStart 已生成，这里直接复用。
        //   ★ 必须在 ssrLoadModule 之前就位：router/index.js import 了 manifest.js，
        //   读到上一轮的空清单 → 内容页路由不匹配 → SSG 渲染出 404 页。
        const content = loadContent(resolve(root, 'src/content'));
        const contentRoutes = content.articles.map((a) => ({
          locale: a.locale,
          slug: a.slug,
          prefix: CATEGORIES[a.category]?.prefix || a.category,
          category: a.category,
        }));

        const sitemapRoutes = [
          ...PUBLIC_ROUTES.map((r) => ({
            basePath: r.path,
            priority:
              r.path === '/' ? '1.0' : ['pricing', 'download'].includes(r.seoKey) ? '0.8' : '0.5',
            changefreq:
              r.path === '/'
                ? 'weekly'
                : ['pricing', 'download'].includes(r.seoKey)
                  ? 'monthly'
                  : 'yearly',
          })),
          // 内容页 priority 0.7：它们是长尾落地页，值得被爬但不该压过定价/下载页。
          // ★ basePath 用**中文路径**（articlePath 已按 locale 生成，这里取 zh 版）
          //   作为 hreflang 拼前缀的基准；同一 slug 的英文 URL 由 pathForLocale 推导。
          ...['fix', 'migrate', 'explain'].flatMap((cat) => {
            const slugs = content.articles.filter((a) => a.category === cat);
            // 每个 slug 只出一条（sitemap 内部会为它生成两种语言）
            const seen = new Set();
            const out = [];
            for (const a of slugs) {
              if (seen.has(a.slug)) continue;
              seen.add(a.slug);
              out.push({
                basePath: `/${CATEGORIES[cat].prefix}/${a.slug}`,
                priority: '0.7',
                changefreq: 'monthly',
              });
            }
            return out;
          }),
        ];
        writeFileSync(
          resolve(distDir, 'sitemap.xml'),
          buildSitemap(sitemapRoutes, pathForLocale, SITE_UPDATED),
          'utf8',
        );
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
        targets.push({
          seoKey: 'notFound',
          routePath: '/en/404',
          outFile: 'en/404.html',
          locale: 'en',
        });

        // 内容文章页
        for (const a of content.articles) {
          const cat = CATEGORIES[a.category];
          // 同分类的相关阅读（同语言、按 order 排，取前 4 篇不含自己）
          const related = (content.byLocale.get(a.locale) || [])
            .filter((x) => x.category === a.category && x.slug !== a.slug)
            .slice(0, 4)
            .map((x) => ({ href: articlePath(x), title: x.frontmatter.title }));
          const localeMeta = LOCALES.reduce((acc, l) => {
            const other = content.bySlug.get(`${l}/${a.slug}`);
            if (other) acc[l] = articlePath(other);
            return acc;
          }, {});

          targets.push({
            seoKey: 'content',
            urlPath: articlePath(a),
            locale: a.locale,
            article: {
              ...a,
              categoryMeta: {
                prefix: cat.prefix,
                label: cat.label[a.locale],
                description: cat.description[a.locale],
                tocLabel: cat.tocLabel?.[a.locale],
                relatedLabel: cat.relatedLabel?.[a.locale],
                cta: cat.cta?.[a.locale],
                ctaLabel: cat.ctaLabel?.[a.locale],
                ctaSecondary: cat.ctaSecondary?.[a.locale],
              },
              related,
              localePaths: localeMeta,
              toc: a.toc,
            },
            seoOverride: {
              title: a.frontmatter.seoTitle,
              description: a.frontmatter.seoDescription,
              keywords: a.frontmatter.keywords || '',
              localePaths: localeMeta,
              breadcrumbLeaf: a.frontmatter.title,
            },
          });
        }

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
          if (t.article) {
            const a = t.article;
            jsonLd.push(
              configMod.getArticleJsonLd({
                headline: a.frontmatter.title,
                description: a.frontmatter.seoDescription,
                url: `${SITE_URL}${t.urlPath}`,
                dateModified: SITE_UPDATED,
                locale: t.locale,
              }),
            );
            // FAQPage：直接用文章里的 FAQ（与页面可见问答**同一份数据**，
            // 不能另算——声明页面上不存在的问答属于结构化数据滥用）。
            if (a.faq.length) {
              jsonLd.push(configMod.getFaqJsonLd(a.faq, `${SITE_URL}${t.urlPath}`));
            }
          }

          const page = await renderPage(routePath, {
            jsonLd,
            article: t.article,
            seoOverride: t.seoOverride,
          });
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
