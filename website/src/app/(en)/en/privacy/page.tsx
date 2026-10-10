import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import PrivacyPage from '@/components/pages/PrivacyPage';

export const metadata: Metadata = buildPageMetadata('privacy', 'en', { path: '/en/privacy' });

export default function Page() {
  return (
    <>
      <PrivacyPage locale="en" />
      <PageJsonLd seoKey="privacy" locale="en" path="/en/privacy" />
    </>
  );
}
