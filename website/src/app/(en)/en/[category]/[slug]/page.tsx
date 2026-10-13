import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getArticleView, listArticleParams } from '@/content/derive';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import ContentPage from '@/components/ContentPage';
import { SITE } from '@/seo/config';

// 内容页（英文树）：/en/[category]/[slug]。与中文树同一套渲染，仅 locale 与 URL 前缀不同。
export const dynamicParams = false;

export function generateStaticParams() {
  return listArticleParams('en');
}

type Props = { params: Promise<{ category: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, slug } = await params;
  const article = getArticleView('en', category, slug);
  if (!article) {
    return buildPageMetadata('notFound', 'en', {
      path: `/en/${category}/${slug}`,
      noindex: true,
    });
  }
  const fm = article.frontmatter;
  return buildPageMetadata('content', 'en', {
    path: `/en/${category}/${slug}`,
    override: {
      title: fm.seoTitle,
      description: fm.seoDescription,
      keywords: fm.keywords || '',
      localePaths: article.localePaths,
      breadcrumbLeaf: fm.title,
    },
  });
}

export default async function Page({ params }: Props) {
  const { category, slug } = await params;
  const article = getArticleView('en', category, slug);
  if (!article) notFound();

  const fm = article.frontmatter;
  const path = `/en/${category}/${slug}`;
  // dateModified 与 sitemap 的 lastmod 同源：都取该文章的发布日期（md frontmatter 的 date）。
  const published = fm.date;

  return (
    <>
      <ContentPage article={article} />
      <PageJsonLd
        seoKey="content"
        locale="en"
        path={path}
        breadcrumbLeaf={fm.title}
        faqItems={article.faq}
        article={{
          headline: fm.title,
          description: fm.seoDescription,
          url: `${SITE.url}${path}`,
          datePublished: published,
          dateModified: published,
          locale: 'en',
        }}
      />
    </>
  );
}
