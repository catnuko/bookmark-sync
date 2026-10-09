import type { Metadata } from 'next';
import '@/styles/main.css';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import ThemeScript from '@/components/layout/ThemeScript';
import AppShell from '@/components/layout/AppShell';

// 英文树 —— /en/* 前缀。独立 root layout 以设置 <html lang="en">。
export const metadata: Metadata = {
  metadataBase: new URL('https://www.bookmark-sync.top'),
};

export default function EnRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeScript />
        <LocaleProvider locale="en">
          <AppShell locale="en">{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
