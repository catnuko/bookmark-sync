/**
 * 内容管线的 TS 类型 —— 描述 content/parse.js 产出的 AST 与 loader.js 的 Article。
 * parse.js / loader.js 保持 .js（纯 Node，逻辑已验证，转 TS 无收益），
 * 这里只给消费方（React 组件、derive.ts）提供类型。
 */
import type { Locale } from '@/i18n/t';

export type InlineNode = { type: 'text' | 'strong' | 'code'; value: string };

export type TableCell = { text: string; inline: InlineNode[] };

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; text: string; inline: InlineNode[] }
  | { type: 'paragraph'; inline: InlineNode[] }
  | { type: 'quote'; inline: InlineNode[] }
  | { type: 'list'; ordered: boolean; items: { inline: InlineNode[] }[] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'table'; header: TableCell[]; rows: TableCell[][] };

export type FaqItem = { q: string; a: string };
export type TocItem = { text: string; anchor: string };

export type CategoryKey = 'guide' | 'fix' | 'migrate' | 'explain';

export type Article = {
  slug: string;
  locale: Locale;
  category: CategoryKey;
  date: string;
  frontmatter: Record<string, string>;
  blocks: Block[];
  faq: FaqItem[];
  lead: string;
  toc: TocItem[];
  sourceFile: string;
};

export type Content = {
  articles: Article[];
  bySlug: Map<string, Article>;
  byLocale: Map<string, Article[]>;
};
