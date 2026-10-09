/**
 * 文章视图派生 —— 迁移前散在 src/seo/vite-plugin.js 的组装逻辑（categoryMeta /
 * related / localePaths）集中到这里，供内容页 server component 使用。
 *
 * ★ 本模块为 **server-only**：它 import 了 content/loader.js（读 fs）。
 *   客户端组件不要 import 它 —— 内容数据由 server component 渲染进 HTML。
 */
import path from 'node:path';
import { CATEGORIES } from './index.js';
import { articlePath, loadContent } from './loader.js';
import type { Article, CategoryKey, Content } from './types';
import type { Locale } from '@/i18n/t';

export type CategoryMeta = {
  prefix: string;
  label: string;
  description: string;
  tocLabel?: string;
  relatedLabel?: string;
  cta?: string;
  ctaLabel?: string;
  ctaSecondary?: string;
};

export type ArticleView = Article & {
  categoryMeta: CategoryMeta;
  related: { href: string; title: string }[];
  localePaths: Partial<Record<Locale, string>>;
};

export function deriveArticleView(a: Article, content: Content): ArticleView {
  const cat = CATEGORIES[a.category as CategoryKey];

  // 同语言、同分类、不含自己，取前 4 篇（byLocale 已按 date 倒序）。
  const related = (content.byLocale.get(a.locale) ?? [])
    .filter((x) => x.category === a.category && x.slug !== a.slug)
    .slice(0, 4)
    .map((x) => ({ href: articlePath(x), title: x.frontmatter.title }));

  const localePaths: Partial<Record<Locale, string>> = {};
  for (const l of ['zh', 'en'] as Locale[]) {
    const other = content.bySlug.get(`${l}/${a.slug}`);
    if (other) localePaths[l] = articlePath(other);
  }

  const categoryMeta: CategoryMeta = {
    prefix: cat.prefix,
    label: cat.label[a.locale],
    description: cat.description[a.locale],
    tocLabel: cat.tocLabel?.[a.locale],
    relatedLabel: cat.relatedLabel?.[a.locale],
    cta: cat.cta?.[a.locale],
    ctaLabel: cat.ctaLabel?.[a.locale],
    ctaSecondary: cat.ctaSecondary?.[a.locale],
  };

  return { ...a, categoryMeta, related, localePaths };
}

// 构建期加载全部内容，模块级缓存（server 进程内只读盘一次）。
let cached: Content | null = null;
export function getContent(): Content {
  if (!cached) {
    cached = loadContent(path.join(process.cwd(), 'src/content')) as unknown as Content;
  }
  return cached;
}

/**
 * 按 locale + URL 前缀 + slug 取一篇文章的视图数据。
 * 前缀必须与文章 category 的 prefix 一致（否则视为 404），保证 URL 与分类自洽。
 */
export function getArticleView(locale: Locale, prefix: string, slug: string): ArticleView | null {
  const content = getContent();
  const a = content.bySlug.get(`${locale}/${slug}`);
  if (!a) return null;
  if (CATEGORIES[a.category as CategoryKey]?.prefix !== prefix) return null;
  return deriveArticleView(a, content);
}

/** 某语言的全部文章 URL 参数（供 generateStaticParams 枚举真实路由）。 */
export function listArticleParams(locale: Locale): { category: string; slug: string }[] {
  const content = getContent();
  return (content.byLocale.get(locale) ?? []).map((a) => ({
    category: CATEGORIES[a.category as CategoryKey]?.prefix || a.category,
    slug: a.slug,
  }));
}

