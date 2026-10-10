import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import SupportPage from '@/components/pages/SupportPage';

export const metadata: Metadata = buildPageMetadata('support', 'en', { path: '/en/support' });

export default function Page() {
  return (
    <>
      <SupportPage locale="en" />
      <PageJsonLd seoKey="support" locale="en" path="/en/support" />
    </>
  );
}
