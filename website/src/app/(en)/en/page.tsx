import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import HomePage from '@/components/pages/HomePage';

export const metadata: Metadata = buildPageMetadata('home', 'en', { path: '/en' });

export default function Page() {
  return (
    <>
      <HomePage locale="en" />
      <PageJsonLd seoKey="home" locale="en" path="/en" />
    </>
  );
}
