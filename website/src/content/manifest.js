/**
 * 内容清单 —— 由 content/{zh,en}/*.md 在**构建期派生**（不再手写、也不再落盘生成）。
 *
 * ★ 迁移前它是 vite-plugin 在 closeBundle 时生成的数据文件（提交进 git 是因为旧方案
 *   的 CSR 侧也要读它、浏览器里没有 fs）。Next 静态导出下内容页全在构建期预渲染，
 *   没有任何客户端读它，于是改成「import 时用 loader 读 fs 算出来」——md 成为唯一来源，
 *   新增文章无需再跑生成步骤，也不会出现「忘记重新生成 manifest」的漂移。
 *
 * ★ 本模块 **server-only**：它 import 了 loader.js（读 fs）。客户端组件不要 import 它。
 */
import path from 'node:path';
import { CATEGORIES } from './index.js';
import { loadContent } from './loader.js';

const content = loadContent(path.join(process.cwd(), 'src/content'));

/** [{ locale, slug, prefix, category, title, seoTitle, description, date }]（按 date 倒序） */
export const CONTENT_ROUTES = content.articles.map((a) => ({
  locale: a.locale,
  slug: a.slug,
  prefix: CATEGORIES[a.category]?.prefix || a.category,
  category: a.category,
  title: a.frontmatter.title,
  seoTitle: a.frontmatter.seoTitle,
  description: a.frontmatter.description,
  date: a.date,
}));

/** 内容分类定义（与 src/content/index.js 的 CATEGORIES 保持一致）。 */
export const CONTENT_CATEGORIES = Object.fromEntries(
  Object.entries(CATEGORIES).map(([key, c]) => [
    key,
    { prefix: c.prefix, label: c.label, description: c.description },
  ]),
);
