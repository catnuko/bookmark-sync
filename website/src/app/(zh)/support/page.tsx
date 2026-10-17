import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import SupportPage from '@/components/pages/SupportPage';

export const metadata: Metadata = buildPageMetadata('support', 'zh', { path: '/support' });

export default function Page() {
  return (
    <>
      <SupportPage locale="zh" />
      <PageJsonLd seoKey="support" locale="zh" path="/support" />
    </>
  );
}
