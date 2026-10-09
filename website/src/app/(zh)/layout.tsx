import type { Metadata } from 'next';
import '@/styles/main.css';
import ThemeScript from '@/components/layout/ThemeScript';

// 中文树 —— 无 URL 前缀。root layout 决定 <html lang>。
export const metadata: Metadata = {
  metadataBase: new URL('https://www.bookmark-sync.top'),
};

export default function ZhRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
