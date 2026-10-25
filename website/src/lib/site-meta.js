// 站点级元信息常量（版本 / 更新时间）
// SITE_UPDATED = **站点级页面**（首页/定价/下载/文档/支持/条款/隐私）最后变更日。
// 只在这些页面本身有实质改动时手动前移 —— 内容页（guide/fix/migrate/explain）的
// 时间戳不取这里，而是各自 md frontmatter 的 date（见 seo/sitemap.ts 与内容页 page.tsx）。
export const SITE_UPDATED = '2026-10-25';
