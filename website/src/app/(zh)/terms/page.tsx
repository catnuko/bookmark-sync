import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import TermsPage from '@/components/pages/TermsPage';

export const metadata: Metadata = buildPageMetadata('terms', 'zh', { path: '/terms' });

export default function Page() {
  return (
    <>
      <TermsPage locale="zh" />
      <PageJsonLd seoKey="terms" locale="zh" path="/terms" />
    </>
  );
}
