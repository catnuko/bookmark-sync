import { buildRobotsTxt } from '@/seo/sitemap';

// 静态导出的 /robots.txt（产物落 out/robots.txt）。
export const dynamic = 'force-static';

export function GET() {
  return new Response(buildRobotsTxt(), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
