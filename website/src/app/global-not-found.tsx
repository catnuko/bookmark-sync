import '@/styles/main.css';

/**
 * 全局 404 —— 多 root layout（zh/en/admin）下没有统一的 app/layout.tsx 包裹全局 404，
 * 所以这里必须渲染**完整文档**（自带 <html>/<body> 并引入全局样式），产出 out/404.html。
 * 与迁移前一致：中文、noindex、不 redirect 回首页（软 404 会被判重复内容降权）。
 */
export default function GlobalNotFound() {
  return (
    <html lang="zh-CN">
      <body>
        <main className="container section">
          <h1>404 · 页面不存在</h1>
          <p>你访问的页面不存在或已被移动。</p>
        </main>
      </body>
    </html>
  );
}
