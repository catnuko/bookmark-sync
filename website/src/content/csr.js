/**
 * CSR 专用的内容数据加载 —— 浏览器里没有 fs，manifest.js 只有元信息
 * （title / description / seoTitle），**没有正文 blocks**。
 *
 * ★ 为什么要这个文件：
 *   内容页的数据此前只由 vite-plugin 在 **SSG 时**通过 app.provide 注入。
 *   于是 CSR 场景（dev server、客户端路由跳转）拿不到数据，
 *   ContentView 直接抛 `[ContentView] 缺少 SSG 注入的 contentArticle`。
 *   线上之所以看不出问题：每个文章 URL 都是预渲染的独立 HTML，点进去是
 *   整页加载，不依赖客户端注入 —— 但 dev server 一进去就崩。
 *
 * 做法：把每篇文章的**预渲染数据**导成一份 JSON，CSR 时按需 fetch。
 *   - 数据源就是 SSG 的产物（同一份渲染结果），不存在两套内容；
 *   - 构建时由 vite-plugin 一起写出，manifest 变了一定同步更新。
 */
import { CONTENT_ROUTES } from './manifest';

/** slug+locale → 预渲染数据 JSON 的 URL */
function dataUrl(slug, locale) {
  return `/content-data/${locale}/${slug}.json`;
}

/**
 * 取文章数据。优先用 SSG 注入的，其次回落到 fetch 预渲染数据。
 *
 * @returns {Promise<object|null>} null = 该文章没有可用数据（调用方决定怎么兜底）
 */
export async function loadArticleForCsr(slug, locale) {
  const known = CONTENT_ROUTES.find((r) => r.slug === slug && r.locale === locale);
  if (!known) return null;
  try {
    const res = await fetch(dataUrl(slug, locale));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // 网络失败不该让整页崩：返回 null，由调用方渲染「加载失败」
    return null;
  }
}

/** 与 SSG 注入的 article 结构对齐，避免 ContentView 里出现两套字段名。 */
export function normalizeInjected(article) {
  return article;
}
