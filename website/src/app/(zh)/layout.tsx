import type { Metadata } from 'next';
import '@/styles/main.css';
import { LocaleProvider } from '@/i18n/LocaleProvider';
import ThemeScript from '@/components/layout/ThemeScript';
import AppShell from '@/components/layout/AppShell';

// 中文树 —— 无 URL 前缀。root layout 决定 <html lang>。
export const metadata: Metadata = {
  metadataBase: new URL('https://www.bookmark-sync.top'),
};

export default function ZhRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeScript />
        <LocaleProvider locale="zh">
          <AppShell locale="zh">{children}</AppShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
