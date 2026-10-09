import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import TermsPage from '@/components/pages/TermsPage';

export const metadata: Metadata = buildPageMetadata('terms', 'en', { path: '/en/terms' });

export default function Page() {
  return (
    <>
      <TermsPage locale="en" />
      <PageJsonLd seoKey="terms" locale="en" path="/en/terms" />
    </>
  );
}
