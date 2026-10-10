import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getArticleView, listArticleParams } from '@/content/derive';
import { buildPageMetadata } from '@/seo/metadata';
import PageJsonLd from '@/seo/PageJsonLd';
import ContentPage from '@/components/ContentPage';
import { SITE } from '@/seo/config';
import { SITE_UPDATED } from '@/lib/site-meta.js';

// 内容页（中文树）：/[category]/[slug]。category 是真实前缀（guide|fix|migrate|explain）。
// 只枚举 manifest 里存在的组合；dynamicParams=false 让未知组合直接 404（静态导出行为）。
export const dynamicParams = false;

export function generateStaticParams() {
  return listArticleParams('zh');
}

type Props = { params: Promise<{ category: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, slug } = await params;
  const article = getArticleView('zh', category, slug);
  if (!article) {
    return buildPageMetadata('notFound', 'zh', { path: `/${category}/${slug}`, noindex: true });
  }
  const fm = article.frontmatter;
  return buildPageMetadata('content', 'zh', {
    path: `/${category}/${slug}`,
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
  const article = getArticleView('zh', category, slug);
  if (!article) notFound();

  const fm = article.frontmatter;
  const path = `/${category}/${slug}`;
  // dateModified 取「max(发布日期, 站点更新日)」：避免出现修改日早于发布日。
  const published = fm.date;
  const modified = published && published > SITE_UPDATED ? published : SITE_UPDATED;

  return (
    <>
      <ContentPage article={article} />
      <PageJsonLd
        seoKey="content"
        locale="zh"
        path={path}
        breadcrumbLeaf={fm.title}
        faqItems={article.faq}
        article={{
          headline: fm.title,
          description: fm.seoDescription,
          url: `${SITE.url}${path}`,
          datePublished: published,
          dateModified: modified,
          locale: 'zh',
        }}
      />
    </>
  );
}
