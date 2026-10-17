import { buildSitemapXml } from '@/seo/sitemap';

// 静态导出的 /sitemap.xml（route handler 走 force-static，产物落 out/sitemap.xml）。
export const dynamic = 'force-static';

export function GET() {
  return new Response(buildSitemapXml(), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
