// 路由表 —— SSG / CSR 唯一来源。
//
// 设计要点（改动前先读）：
//   1. **URL 是语言的唯一权威**。locale 不再存 localStorage，而是由路径前缀推导：
//        无前缀 = 中文，/en/* = 英文。canonical 与 hreflang 才可能自洽（见 seo/config.js）。
//   2. 每条路由带 meta.seoKey —— **路由 name 不再用于查 SEO 文案**，因为 name 现在带
//      locale 后缀（pricing / en-pricing）。SEO 文案统一按 seoKey 取。
//   3. 404 不再 redirect 回首页。软 404 会让 Google 把不存在的 URL 当首页重复内容降权。
//   4. 内容页（markdown 驱动）**静态展开**成真实路由，不用动态匹配 —— 否则
//      任意 /xxx/yyy 都会 200，拼错的 URL 也进索引。
import NotFoundView from '../views/NotFoundView.vue';
import ContentView from '../components/ContentView.vue';

/** 公开可索引页面。 */
export const PUBLIC_ROUTES = [
  { path: '/', seoKey: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/pricing', seoKey: 'pricing', component: () => import('../views/PricingView.vue') },
  { path: '/download', seoKey: 'download', component: () => import('../views/DownloadView.vue') },
  { path: '/docs', seoKey: 'docs', component: () => import('../views/DocsView.vue') },
  { path: '/support', seoKey: 'support', component: () => import('../views/SupportView.vue') },
  { path: '/privacy', seoKey: 'privacy', component: () => import('../views/PrivacyView.vue') },
  { path: '/terms', seoKey: 'terms', component: () => import('../views/TermsView.vue') },
];

/**
 * 生成路由表。
 *
 * @param {object[]} [adminRoutes] /admin/** 子路由。SSG 不传 —— 后台不进索引，
 *   也避免把 supabase 客户端拖进预渲染进程。
 * @param {object[]} [contentRoutes] 内容文章 {locale, slug, prefix}。
 *   SSG 与 CSR 都传（由调用方从 loadContent 展开）—— 两边不一致会 hydration 报错。
 */
export function buildRoutes(adminRoutes = [], contentRoutes = []) {
  const routes = [];

  for (const r of PUBLIC_ROUTES) {
    routes.push({
      path: r.path,
      name: r.seoKey,
      component: r.component,
      meta: { seoKey: r.seoKey },
    });
    // 英文镜像：/pricing → /en/pricing；'/' → '/en'（不是 '/en/'）
    routes.push({
      path: r.path === '/' ? '/en' : `/en${r.path}`,
      name: `en-${r.seoKey}`,
      component: r.component,
      meta: { seoKey: r.seoKey },
    });
  }

  routes.push(...adminRoutes);

  // 内容文章（markdown 驱动）。
  // ★ 静态展开而不是用 '/:category/:slug' 动态匹配 —— 动态匹配会让所有
  //   /xxx/yyy 都被当成文章（拼错 URL 变成 200 而不是 404），SEO 上是灾难。
  //   代价是新增文章要重建（本来就该重建：sitemap / SSG / hreflang 都要跟上）。
  if (contentRoutes) {
    for (const c of contentRoutes) {
      const base = `/${c.prefix}/${c.slug}`;
      routes.push({
        path: base,
        name: `content-${c.locale === 'en' ? 'en-' : ''}${c.slug}`,
        component: ContentView,
        meta: { seoKey: 'content', contentSlug: c.slug, contentLocale: c.locale },
      });
      routes.push({
        path: `/en${base}`,
        name: `content-en-${c.slug}`,
        component: ContentView,
        meta: { seoKey: 'content', contentSlug: c.slug, contentLocale: 'en' },
      });
    }
  }

  // 404：渲染 noindex 页，而非 redirect 回 '/'
  routes.push({
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
    meta: { seoKey: 'notFound', noindex: true },
  });

  return routes;
}

/**
 * 从路径推导 locale：/en/* → 'en'，其余 → 'zh'。
 * SSG 与 CSR 共用这一份判断 —— 两边不一致会导致 hydration 报错。
 */
export function localeFromPath(path) {
  return path === '/en' || path.startsWith('/en/') ? 'en' : 'zh';
}

/**
 * 生成某 locale 下的 URL。英文是**前缀** /en/*，不是后缀。
 *   ('/pricing','en') → '/en/pricing'   ('/pricing','zh') → '/pricing'
 *   ('/','en')        → '/en'           ('/','zh')        → '/'
 *   ('/en/pricing','zh') → '/pricing'   （从英文页切回中文要去掉前缀）
 *   ('/en','zh')      → '/'
 *
 * ★ 判前缀用 `startsWith('/en/')` —— `'/en'.startsWith('/en/')` 是 false，
 *   所以首页英文要单独处理。正则 `/^\/en(\/|$)/` 是等价的，但这里用显式判断更好读。
 */
export function pathForLocale(path, locale) {
  const bare = path === '/en' || path.startsWith('/en/') ? path.slice(3) || '/' : path;
  const clean = bare === '/' ? '' : bare.replace(/\/$/, '');
  if (locale !== 'en') return clean || '/';
  return clean ? `/en${clean}` : '/en';
}
