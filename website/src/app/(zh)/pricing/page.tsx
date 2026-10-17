import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import PricingPage from '@/components/pages/PricingPage';

export const metadata: Metadata = buildPageMetadata('pricing', 'zh', { path: '/pricing' });

export default function Page() {
  return (
    <>
      <PricingPage locale="zh" />
      <PageJsonLd seoKey="pricing" locale="zh" path="/pricing" />
    </>
  );
}
