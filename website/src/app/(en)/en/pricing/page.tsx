import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import PricingPage from '@/components/pages/PricingPage';

export const metadata: Metadata = buildPageMetadata('pricing', 'en', { path: '/en/pricing' });

export default function Page() {
  return (
    <>
      <PricingPage locale="en" />
      <PageJsonLd seoKey="pricing" locale="en" path="/en/pricing" />
    </>
  );
}
