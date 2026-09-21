/**
 * Vite 插件：构建时生成 sitemap.xml 和 robots.txt
 *
 * 设计意图：
 *   - 路由列表与 src/router/index.js 保持单一来源（手动同步即可，路由少）
 *   - 输出到 dist/ 根目录，Vercel 直接静态服务
 *   - 同时输出 zh / en 两个 locale 的 hreflang alternate，帮助 Google 选择对应语言版本
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SITE_URL = 'https://www.bookmark-sync.top';
const LOCALES = ['zh', 'en'];

const ROUTES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/pricing', priority: '0.9', changefreq: 'monthly' },
  { path: '/download', priority: '0.9', changefreq: 'monthly' },
  { path: '/docs', priority: '0.7', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
  { path: '/terms', priority: '0.3', changefreq: 'yearly' },
];

function buildSitemap() {
  const urls = ROUTES.map((r) => {
    const alternates = LOCALES.map(
      (loc) =>
        `    <xhtml:link rel="alternate" hreflang="${loc === 'zh' ? 'zh-CN' : 'en'}" href="${SITE_URL}${r.path}"/>`,
    ).join('\n');

    return `  <url>
    <loc>${SITE_URL}${r.path}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
${alternates}
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
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

export function seoStaticPlugin() {
  return {
    name: 'seo-static',
    apply: 'build',
    closeBundle() {
      const distDir = resolve(process.cwd(), 'dist');
      mkdirSync(distDir, { recursive: true });

      writeFileSync(resolve(distDir, 'sitemap.xml'), buildSitemap(), 'utf8');
      writeFileSync(resolve(distDir, 'robots.txt'), buildRobots(), 'utf8');

      // 同时输出到 public/，让 dev 服务器也能访问到（dev 模式下 closeBundle 不触发，
      // 但 build 模式下 public/ 的副本会被 Vite 自动复制到 dist/，所以这里写 dist 即可）
      console.log('[seo-static] sitemap.xml + robots.txt generated in dist/');
    },
  };
}
