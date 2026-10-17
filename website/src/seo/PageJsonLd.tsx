import {
  getArticleJsonLd,
  getBreadcrumbJsonLd,
  getFaqJsonLd,
  getOrganizationJsonLd,
  getSoftwareAppJsonLd,
  SITE,
  type Locale,
} from './config';
import { faqItemsFor } from './faq';
import JsonLd from './JsonLd';

/**
 * 公开页通用 JSON-LD 集合：Organization + SoftwareApplication + BreadcrumbList
 * （+ 可选 Article / FAQPage）。与迁移前 useSEO 输出的三块 + vite-plugin 追加的
 * Article / FAQPage 对齐，**顺序一致**：Org → SoftwareApp → Breadcrumb → Article → FAQPage。
 *
 * FAQPage 的条目：显式传入优先（内容页传文章自带 FAQ）；否则按 seoKey 查表
 * （home / pricing / support 三页，见 faq.ts 的 faqItemsFor）。
 */
export default function PageJsonLd({
  seoKey,
  locale,
  path,
  breadcrumbLeaf,
  faqItems,
  article,
}: {
  seoKey: string;
  locale: Locale;
  path: string;
  breadcrumbLeaf?: string;
  faqItems?: { q: string; a: string }[];
  article?: Parameters<typeof getArticleJsonLd>[0];
}) {
  const url = `${SITE.url}${path}`;
  const items = faqItems ?? faqItemsFor(seoKey, locale);
  return (
    <>
      <JsonLd data={getOrganizationJsonLd(locale)} />
      <JsonLd data={getSoftwareAppJsonLd(locale)} />
      <JsonLd data={getBreadcrumbJsonLd(seoKey, locale, breadcrumbLeaf)} />
      {article ? <JsonLd data={getArticleJsonLd(article)} /> : null}
      {items.length > 0 ? <JsonLd data={getFaqJsonLd(items, url)} /> : null}
    </>
  );
}
