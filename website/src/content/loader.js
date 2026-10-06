/**
 * 内容加载 —— Node 侧（SSG 构建期）读 content 目录下的 md。
 *
 * ★ 为什么在 Node 侧读而不是 import.meta.glob：
 *   vite 的 glob 只在 Vite 编译路径下工作，而 SSR bundle 里 fs 是可用的；
 *   更重要的是我们需要在构建期就拿到完整列表来生成 sitemap 与 SSG 目标，
 *   这本来就发生在 Node 侧。
 *
 * 一致性判据：**客户端拿到的内容必须与服务端渲染的完全一致**，否则 hydration mismatch。
 * 所以这个加载器只在 SSG 路径（Node）使用；客户端不import 它——
 * 内容数据经由 ssg.js 的渲染结果进入 HTML，客户端 hydrate 时不会重新解析 md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseMarkdown, parseFrontmatter } from './parse.js';
import { CATEGORIES } from './index.js';

const LOCALES = ['zh', 'en'];
const REQUIRED_FIELDS = ['title', 'description', 'category', 'seoTitle', 'seoDescription'];

/**
 * 加载全部内容。
 *
 * @param {string} contentDir 绝对路径（website/src/content）
 * @returns {{ articles: object[], bySlug: Map, byLocale: Map }}
 *   article = { slug, locale, category, order, frontmatter, blocks, faq, lead }
 */
export function loadContent(contentDir) {
  const articles = [];
  const problems = [];

  for (const locale of LOCALES) {
    const dir = path.join(contentDir, locale);
    if (!fs.existsSync(dir)) {
      problems.push(`缺少内容目录：${dir}`);
      continue;
    }
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const slug = file.replace(/\.md$/, '');
      const full = path.join(dir, file);
      const raw = fs.readFileSync(full, 'utf8');
      const { data, body } = parseFrontmatter(raw);

      // ── frontmatter 校验：字段缺失在 SSG 时才暴露成空 title，比构建报错更难查 ──
      for (const k of REQUIRED_FIELDS) {
        if (!data[k]) problems.push(`${locale}/${file} 缺 frontmatter 字段：${k}`);
      }
      if (data.category && !CATEGORIES[data.category]) {
        problems.push(
          `${locale}/${file} 的 category="${data.category}" 不存在（可用：${Object.keys(CATEGORIES).join(', ')}）`,
        );
      }

      const { blocks, faq, lead, toc } = parseMarkdown(body, `${locale}/${file}`);
      if (data.faq === 'true' && faq.length === 0) {
        problems.push(`${locale}/${file} 声明了 faq: true 但没有「## FAQ」小节`);
      }
      if (!lead) problems.push(`${locale}/${file} 没有页首摘要（h1 之后需有正文）`);

      articles.push({
        slug,
        locale,
        category: data.category,
        order: Number(data.order) || 99,
        frontmatter: data,
        blocks,
        faq,
        lead,
        toc,
        sourceFile: `${locale}/${file}`,
      });
    }
  }

  // ── 双语完整性：缺一侧的页面会留下 hreflang 空洞（指向 404）──
  const slugsByLocale = new Map(LOCALES.map((l) => [l, new Set()]));
  for (const a of articles) slugsByLocale.get(a.locale).add(a.slug);
  for (const slug of slugsByLocale.get('zh') || []) {
    if (!slugsByLocale.get('en')?.has(slug)) problems.push(`slug "${slug}" 有中文但缺英文版`);
  }
  for (const slug of slugsByLocale.get('en') || []) {
    if (!slugsByLocale.get('zh')?.has(slug)) problems.push(`slug "${slug}" 有英文但缺中文版`);
  }

  if (problems.length) {
    throw new Error(`[content] 内容校验失败：\n  - ${problems.join('\n  - ')}`);
  }

  articles.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

  const bySlug = new Map();
  const byLocale = new Map();
  for (const a of articles) {
    bySlug.set(`${a.locale}/${a.slug}`, a);
    if (!byLocale.has(a.locale)) byLocale.set(a.locale, []);
    byLocale.get(a.locale).push(a);
  }

  return { articles, bySlug, byLocale };
}

/**
 * 某篇文章的 URL 路径。
 *   { category: 'fix', slug: 'folder-rename-loses-children', locale: 'zh' }
 *     → '/fix/folder-rename-loses-children'
 *     → '/en/fix/folder-rename-loses-children'
 */
export function articlePath(a) {
  const prefix = CATEGORIES[a.category]?.prefix || a.category;
  const base = `/${prefix}/${a.slug}`;
  return a.locale === 'en' ? `/en${base}` : base;
}