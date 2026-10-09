/**
 * sitemap.xml / robots.txt 生成 —— 迁移前 src/seo/vite-plugin.js 的 buildSitemap /
 * buildRobots 的 TS 移植，**输出逐字节保持一致**（含 xhtml:link 交替链接与缩进）。
 *
 * ★ 路由清单直接 import src/lib/routes.mjs 与内容 manifest，不手抄 —— 手抄必然漏页。
 * ★ lastmod 用「内容真实最后更新日」（SITE_UPDATED），**不要**用构建日期：用构建日期
 *   会让每次 CI 都声称全部 URL 更新，Google 判 sitemap 不可信并整体降权。
 */
import { PUBLIC_ROUTES } from '@/lib/routes.mjs';
import { CATEGORIES } from '@/content/index.js';
import { getContent } from '@/content/derive';
import { SITE_UPDATED } from '@/lib/site-meta.js';
import { pathForLocale } from '@/i18n/paths';
import type { Locale } from '@/i18n/t';

const SITE_URL = 'https://www.bookmark-sync.top';
const LOCALES: Locale[] = ['zh', 'en'];
const HREFLANG: Record<Locale, string> = { zh: 'zh-CN', en: 'en' };

export type SitemapRoute = { basePath: string; priority: string; changefreq: string };

function buildSitemap(routes: SitemapRoute[], lastmod: string): string {
  const entries: string[] = [];

  for (const r of routes) {
    for (const loc of LOCALES) {
      const urlPath = pathForLocale(r.basePath, loc);
      const alternates = LOCALES.map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${SITE_URL}${pathForLocale(r.basePath, l)}"/>`,
      ).join('\n');
      entries.push(
        `  <url>
    <loc>${SITE_URL}${urlPath}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}${pathForLocale(r.basePath, 'zh')}"/>
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

/** 全部进 sitemap 的 basePath（去掉语言前缀）。 */
export function sitemapRoutes(): SitemapRoute[] {
  const content = getContent();

  // 内容页 priority 0.7：长尾落地页，值得被爬但不该压过定价/下载页。
  // 每个 slug 只出一条（buildSitemap 内部会为它生成两种语言）。
  const contentRoutes = ['guide', 'fix', 'migrate', 'explain'].flatMap((cat) => {
    const seen = new Set<string>();
    const out: SitemapRoute[] = [];
    for (const a of content.articles) {
      if (a.category !== cat || seen.has(a.slug)) continue;
      seen.add(a.slug);
      out.push({
        basePath: `/${CATEGORIES[cat as keyof typeof CATEGORIES].prefix}/${a.slug}`,
        priority: '0.7',
        changefreq: 'monthly',
      });
    }
    return out;
  });

  return [
    ...PUBLIC_ROUTES.map((r) => ({
      basePath: r.path,
      priority: r.priority,
      changefreq: r.changefreq,
    })),
    ...contentRoutes,
  ];
}

export function buildSitemapXml(): string {
  return buildSitemap(sitemapRoutes(), SITE_UPDATED);
}

export function buildRobotsTxt(): string {
  return `# robots.txt for ${SITE_URL}
User-agent: *
Allow: /
Disallow: /admin

# Sitemap
Sitemap: ${SITE_URL}/sitemap.xml
`;
}
