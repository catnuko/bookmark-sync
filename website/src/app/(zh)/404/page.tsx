import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import NotFoundPage from '@/components/pages/NotFoundPage';

// /404（中文树）→ 静态导出为 out/404.html，由托管平台作为「未匹配路径」的兜底页。
// noindex, nofollow；不 redirect 回首页（软 404 会被判与首页重复而拉低全站质量）。
export const metadata: Metadata = buildPageMetadata('notFound', 'zh', {
  path: '/404',
  noindex: true,
});

export default function Page() {
  return <NotFoundPage locale="zh" />;
}
