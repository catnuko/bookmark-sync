import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import NotFoundPage from '@/components/pages/NotFoundPage';

// /en/404（英文树）→ 静态导出为 out/en/404.html。
export const metadata: Metadata = buildPageMetadata('notFound', 'en', {
  path: '/en/404',
  noindex: true,
});

export default function Page() {
  return (
    <>
      <NotFoundPage locale="en" />
      <PageJsonLd seoKey="notFound" locale="en" path="/en/404" />
    </>
  );
}
