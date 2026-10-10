import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import HomePage from '@/components/pages/HomePage';

export const metadata: Metadata = buildPageMetadata('home', 'zh', { path: '/' });

export default function Page() {
  return (
    <>
      <HomePage locale="zh" />
      <PageJsonLd seoKey="home" locale="zh" path="/" />
    </>
  );
}
