import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import DocsPage from '@/components/pages/DocsPage';

export const metadata: Metadata = buildPageMetadata('docs', 'en', { path: '/en/docs' });

export default function Page() {
  return (
    <>
      <DocsPage locale="en" />
      <PageJsonLd seoKey="docs" locale="en" path="/en/docs" />
    </>
  );
}
