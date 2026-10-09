/**
 * SSG 预渲染 —— 把每个公开路由渲染成独立静态 HTML。
 *
 * 为什么必须做：整站原本是 CSR，`dist/index.html` 是空壳 `<div id="app"></div>`。
 * Google 能跑 JS 才拿到内容，但大量爬虫（以及所有社交卡片抓取器、预览服务、
 * 部分 AI 检索器）不执行 JS → 7 个路由共用同一份 HTML = 触发重复内容判定。
 * SSG 让每个 URL 都有独立的 title/description/canonical/正文。
 *
 * 四个必须遵守的约束（改之前先想清楚）：
 *   1. **每页独立 router + 独立 i18n 实例**。vue-router 的 currentRoute 与
 *      vue-i18n 的 locale 都是实例级可变状态，复用会串页（上一轮组件还挂着）。
 *   2. **不挂 admin 路由**。/admin 要连 supabase，且绝不该进索引。
 *   3. **head 渲染必须在 renderToString 之后**，因为 useSEO 依赖 router/locale
 *      在渲染过程中才确定值。
 *   4. **内容页的数据通过 provide 注入**，而不是让客户端重新解析 md。
 *      客户端 hydrate 时拿不到 Node 侧的 fs，若让它自己解析必然与SSR 不一致
 *      → hydration mismatch。SSG 的 HTML 里已经有完整正文，客户端只需要挂载。
 */
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createHead } from '@unhead/vue';
import App from '../App.vue';
import { createAppRouter } from '../router';
import { createI18nInstance } from '../i18n';
import { localeFromPath } from '../router/routes';
import { renderHeadTags } from './renderHead';

/**
 * 渲染单个路径。
 *
 * @param {string} path 如 '/pricing' / '/en/pricing' / '/fix/xxx'
 * @param {object} [opts]
 * @param {object} [opts.article] 内容页数据（内容页必传，其余路由省略）
 * @param {object[]} [opts.jsonLd] 额外注入的 JSON-LD（FAQPage / Article 等）
 * @param {object} [opts.seoOverride] 覆盖 SEO 文案（内容页用自己的 title/description）
 * @returns {Promise<{ html: string, head: string, htmlAttrs: string, locale: string }>}
 */
export async function renderPage(path, opts = {}) {
  const locale = localeFromPath(path);
  const router = createAppRouter(false);
  const i18n = createI18nInstance(locale);

  await router.push(path);
  await router.isReady();

  const head = createHead();
  const app = createSSRApp(App);

  // 内容页数据注入：ContentView 用 inject('contentArticle') 取。
  // ★ 必须在 app.use(router) 之前 —— provide/inject 依赖组件树建立时的上下文。
  if (opts.article) {
    app.provide('contentArticle', opts.article);
    if (opts.seoOverride) app.provide('contentSeoOverride', opts.seoOverride);
  }

  app.use(head);
  app.use(router);
  app.use(i18n);

  const html = await renderToString(app);

  // ★ head 必须在 renderToString 之后取：useSEO 依赖 router/locale，
  //   而这些在渲染过程中才确定值。
  const tags = await head.resolveTags();

  // 额外 JSON-LD（FAQPage / Article 等）在这里追加：它们来自内容数据，
  // 不经过组件渲染，只能由调用方组装。
  for (const d of opts.jsonLd || []) {
    if (!d) continue;
    tags.push({
      tag: 'script',
      props: { type: 'application/ld+json' },
      innerHTML: JSON.stringify(d),
    });
  }

  const { headHtml, htmlAttrs } = renderHeadTags(tags);
  // article 带出来给 vite-plugin：内容页要把它内联进 HTML，供客户端首帧同步读取
  // （否则客户端 inject 拿不到 Node 侧的 provide，先渲染「正在加载」兜底 → hydration
  // mismatch）。见 vite-plugin.js 的 injectIntoTemplate 与 ContentView.vue。
  return { html, head: headHtml, htmlAttrs, locale, article: opts.article || null };
}
