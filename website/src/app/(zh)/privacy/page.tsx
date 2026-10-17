import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import PrivacyPage from '@/components/pages/PrivacyPage';

export const metadata: Metadata = buildPageMetadata('privacy', 'zh', { path: '/privacy' });

export default function Page() {
  return (
    <>
      <PrivacyPage locale="zh" />
      <PageJsonLd seoKey="privacy" locale="zh" path="/privacy" />
    </>
  );
}
