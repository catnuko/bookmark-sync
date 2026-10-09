import '@/styles/main.css';

// Admin 树 —— 纯客户端后台，无 header/footer。root layout 只提供 html/body 外壳。
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
