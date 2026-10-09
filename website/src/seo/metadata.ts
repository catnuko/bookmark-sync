/**
 * 页面 metadata 组装 —— 对应迁移前 src/seo/useSEO.js 的 head 输出。
 * 逐项对齐：title/description/keywords/author/robots/OpenGraph/Twitter/canonical/hreflang。
 */
import type { Metadata } from 'next';
import { LOCALE_TAGS, ROUTE_SEO, SITE, type Locale } from './config';
import { pathForLocale } from '@/i18n/paths';

export type SeoOverride = {
  title?: string;
  description?: string;
  keywords?: string;
  localePaths?: Partial<Record<Locale, string>>;
  breadcrumbLeaf?: string;
};

const ROBOTS_INDEX =
  'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const ROBOTS_NOINDEX = 'noindex, nofollow';

export function buildPageMetadata(
  seoKey: string,
  locale: Locale,
  opts: { path: string; override?: SeoOverride; noindex?: boolean },
): Metadata {
  const base =
    ROUTE_SEO[seoKey]?.[locale] ??
    ROUTE_SEO[seoKey]?.[SITE.defaultLocale] ??
    ROUTE_SEO.home[locale];
  const ov = opts.override;

  const title = ov?.title || base.title;
  const description = ov?.description || base.description;
  const keywords = ov?.keywords ?? base.keywords;

  const languages = ov?.localePaths
    ? {
        'zh-CN': ov.localePaths.zh,
        en: ov.localePaths.en,
        'x-default': ov.localePaths[SITE.defaultLocale],
      }
    : {
        'zh-CN': pathForLocale(opts.path, 'zh'),
        en: pathForLocale(opts.path, 'en'),
        'x-default': pathForLocale(opts.path, SITE.defaultLocale),
      };

  const md: Metadata = {
    title,
    description,
    keywords,
    authors: [{ name: SITE.name }],
    // 用 other 而不是 metadata.robots —— 后者会被 Next 拆成 robots + googlebot 两条 meta，
    // 与原站「单条 robots」不一致，自检也会数错。
    other: { robots: opts.noindex ? ROBOTS_NOINDEX : ROBOTS_INDEX },
    openGraph: {
      type: 'website',
      siteName: SITE.name,
      title,
      description,
      url: opts.path,
      locale: LOCALE_TAGS[locale].og,
      alternateLocale: [locale === 'zh' ? LOCALE_TAGS.en.og : LOCALE_TAGS.zh.og],
      images: [
        {
          url: SITE.ogImage,
          width: 2560,
          height: 1440,
          type: 'image/jpeg',
          alt: `${SITE.name} · ${title}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{ url: SITE.ogImage, alt: `${SITE.name} · ${title}` }],
    },
  };

  if (!opts.noindex) {
    md.alternates = { canonical: opts.path, languages };
  }
  return md;
}
