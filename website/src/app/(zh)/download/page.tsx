import type { Metadata } from 'next';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import DownloadPage from '@/components/pages/DownloadPage';

export const metadata: Metadata = buildPageMetadata('download', 'zh', { path: '/download' });

export default function Page() {
  return (
    <>
      <DownloadPage />
      <PageJsonLd seoKey="download" locale="zh" path="/download" />
    </>
  );
}
