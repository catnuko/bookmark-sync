/**
 * sitemap.xml / robots.txt 生成 —— 迁移前 src/seo/vite-plugin.js 的 buildSitemap /
 * buildRobots 的 TS 移植，**输出逐字节保持一致**（含 xhtml:link 交替链接与缩进）。
 *
 * ★ 路由清单直接 import src/lib/routes.mjs 与内容 manifest，不手抄 —— 手抄必然漏页。
 * ★ lastmod **逐 URL 取真实日期**，不要用构建日期：用构建日期会让每次 CI 都声称全部 URL
 *   更新，Google 判 sitemap 不可信并整体降权。内容页取该 slug 的发布日期（md frontmatter
 *   的 date），站点级页面取 SITE_UPDATED —— 两者都是「内容真的动过」的日期，且各不相同。
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

export type SitemapRoute = {
  basePath: string;
  priority: string;
  changefreq: string;
  lastmod: string;
};

function buildSitemap(routes: SitemapRoute[]): string {
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
    <lastmod>${r.lastmod}</lastmod>
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

  // 内容页：lastmod 取该 slug 的**真实发布日期**（md frontmatter 的 date）。
  // 每个 slug 只出一条（buildSitemap 内部会为它生成两种语言），中英两版取较新的一侧。
  const contentRoutes = ['guide', 'fix', 'migrate', 'explain'].flatMap((cat) => {
    const latestBySlug = new Map<string, string>();
    for (const a of content.articles) {
      if (a.category !== cat) continue;
      const prev = latestBySlug.get(a.slug);
      if (!prev || a.date > prev) latestBySlug.set(a.slug, a.date);
    }
    return [...latestBySlug].map(([slug, date]) => ({
      basePath: `/${CATEGORIES[cat as keyof typeof CATEGORIES].prefix}/${slug}`,
      priority: '0.7',
      changefreq: 'monthly',
      lastmod: date,
    }));
  });

  // 站点级页面没有 per-page 日期，统一用 SITE_UPDATED（见 lib/site-meta.js 的维护约定）。
  return [
    ...PUBLIC_ROUTES.map((r) => ({
      basePath: r.path,
      priority: r.priority,
      changefreq: r.changefreq,
      lastmod: SITE_UPDATED,
    })),
    ...contentRoutes,
  ];
}

export function buildSitemapXml(): string {
  return buildSitemap(sitemapRoutes());
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
