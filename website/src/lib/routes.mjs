/**
 * 公开可索引页面 —— sitemap 与 check-ssg 的唯一来源（不手抄路由）。
 * 迁移前取自 src/router/routes.js 的 PUBLIC_ROUTES；这里保留 path/seoKey 并带上
 * sitemap 用的 priority/changefreq（与原 vite-plugin 的取值逻辑一致）。
 */
export const PUBLIC_ROUTES = [
  { path: '/', seoKey: 'home', priority: '1.0', changefreq: 'weekly' },
  { path: '/pricing', seoKey: 'pricing', priority: '0.8', changefreq: 'monthly' },
  { path: '/download', seoKey: 'download', priority: '0.8', changefreq: 'monthly' },
  { path: '/docs', seoKey: 'docs', priority: '0.5', changefreq: 'yearly' },
  { path: '/support', seoKey: 'support', priority: '0.5', changefreq: 'yearly' },
  { path: '/privacy', seoKey: 'privacy', priority: '0.5', changefreq: 'yearly' },
  { path: '/terms', seoKey: 'terms', priority: '0.5', changefreq: 'yearly' },
];
