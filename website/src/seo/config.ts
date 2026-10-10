/**
 * SEO 配置中心（迁移前 src/seo/config.js 的 TS 移植，行为不变）
 * - 站点级常量、路由级 SEO 文案（中英双语）、JSON-LD 结构化数据
 *
 * ★ URL 即语言权威：中文 = 无前缀（/pricing），英文 = /en 前缀（/en/pricing）。
 */

export type Locale = 'zh' | 'en';

export const SITE = {
  url: 'https://www.bookmark-sync.top',
  name: 'BookmarkSync',
  /** 无前缀 URL 的语言（也作为 hreflang 的 x-default）。 */
  defaultLocale: 'zh' as Locale,
  locales: ['zh', 'en'] as Locale[],
  shortName: 'BookmarkSync',
  ogImage: 'https://www.bookmark-sync.top/og-image.jpg',
  email: 'support@bookmark-sync.top',
  /** 留空则不输出 sameAs / twitter:site（填不存在的账号等于伪造实体）。 */
  twitter: '',
};

/** 各语言的 BCP 47 / OG locale 标签。 */
export const LOCALE_TAGS = {
  zh: { hreflang: 'zh-CN', og: 'zh_CN', htmlLang: 'zh-CN' },
  en: { hreflang: 'en', og: 'en_US', htmlLang: 'en' },
} as const;

export type SeoCopy = { title: string; description: string; keywords: string };

/** 路由级 SEO 文案（按 seoKey 查，与路由表一一对应）。 */
export const ROUTE_SEO: Record<string, Record<Locale, SeoCopy>> = {
  home: {
    zh: {
      title: 'BookmarkSync · 跨浏览器书签同步与备份工具',
      description:
        '跨浏览器书签云同步工具，支持 Chrome / Edge / Firefox 之间书签自动同步，跨设备与跨时间保持一致。真树结构，文件夹改名/移动不丢子项；精准删除永不复活；多端并发编辑自动收敛、无覆盖写。免费 500 条书签起步，Plus / Pro 按年订阅解锁更多条数。',
      keywords:
        '书签同步,书签备份,跨浏览器书签,Chrome 书签同步,Edge 书签同步,Firefox 书签同步,书签云同步,书签多设备同步,书签迁移,文件夹改名不丢子项',
    },
    en: {
      title: 'BookmarkSync · Cross-browser bookmark sync & backup',
      description:
        'Cross-browser bookmark cloud sync tool. Syncs bookmarks across Chrome, Edge, and Firefox with true-tree sync — renaming or moving folders never loses children — tombstone-based deletes that never resurrect, and convergent multi-device merge with no overwrites. Start free with 500 bookmarks; Plus and Pro are yearly subscriptions for more.',
      keywords:
        'bookmark sync,bookmark backup,cross-browser bookmarks,Chrome bookmark sync,Edge bookmark sync,Firefox bookmark sync,bookmark cloud sync,bookmark multi-device sync,bookmark migration,folders no lost children',
    },
  },
  pricing: {
    zh: {
      title: '定价 · BookmarkSync | 免费 500 条，Plus / Pro 按年订阅',
      description:
        'BookmarkSync 定价：Free 最多 500 条书签永久免费、Plus $20/年 10,000 条、Pro $50/年 不限数量。三档同步功能完全一致，仅书签数量上限不同。订阅由 Creem 处理。',
      keywords:
        'BookmarkSync 定价,书签同步价格,书签同步付费,书签同步订阅,书签同步 Plus,书签同步 Pro',
    },
    en: {
      title: 'Pricing · BookmarkSync | Free 500 bookmarks, Plus / Pro yearly',
      description:
        'BookmarkSync pricing: Free up to 500 bookmarks, Plus $20/yr for 10,000, Pro $50/yr unlimited. All tiers share identical sync features — only the bookmark limit differs. Subscriptions processed by Creem.',
      keywords:
        'BookmarkSync pricing,bookmark sync price,bookmark sync plans,bookmark sync subscription,bookmark sync Plus,bookmark sync Pro',
    },
  },
  download: {
    zh: {
      title: '下载 · BookmarkSync | Chrome / Edge / Firefox',
      description:
        'BookmarkSync 浏览器扩展下载页，点击跳转 Chrome Web Store、Edge Add-ons、Firefox Add-ons 安装。一次配置，所有设备浏览器书签永不丢失。',
      keywords:
        'BookmarkSync 下载,书签同步插件,书签同步扩展,Chrome 书签插件,Edge 书签插件,Firefox 书签插件',
    },
    en: {
      title: 'Download · BookmarkSync | Chrome / Edge / Firefox',
      description:
        'Download the BookmarkSync browser extension. Jump to Chrome Web Store, Edge Add-ons, or Firefox Add-ons. Configure once — never lose bookmarks across devices again.',
      keywords:
        'BookmarkSync download,bookmark sync extension,bookmark sync plugin,Chrome bookmark extension,Edge bookmark extension,Firefox bookmark extension',
    },
  },
  docs: {
    zh: {
      title: '文章 · BookmarkSync | 书签同步的上手、原理与排障',
      description:
        'BookmarkSync 文章：快速上手、跨浏览器迁移、同步原理与故障排查。所有内容按发布时间排列，帮你把书签同步彻底用明白。',
      keywords:
        'BookmarkSync 文章,书签同步教程,书签同步使用,跨浏览器书签迁移,书签同步原理,书签同步故障排查',
    },
    en: {
      title: 'Articles · BookmarkSync',
      description:
        'BookmarkSync articles: quick start, cross-browser migration, how the sync engine works, and troubleshooting — all in one timeline, newest first.',
      keywords:
        'BookmarkSync articles,bookmark sync guide,bookmark sync usage,cross-browser bookmark migration,bookmark sync internals,bookmark sync troubleshooting',
    },
  },
  support: {
    zh: {
      title: '支持与帮助 · BookmarkSync',
      description:
        'BookmarkSync 支持与帮助：常见问题（注册、浏览器支持、免费额度、新设备恢复、数据安全、同步口令、多设备合并），联系邮箱 support@bookmark-sync.top。',
      keywords: 'BookmarkSync 帮助,书签同步常见问题,书签同步支持,书签同步联系',
    },
    en: {
      title: 'Support & Help · BookmarkSync',
      description:
        'BookmarkSync support & help: FAQ on sign-up, browser support, free quota, restoring on a new device, data security, sync passphrase and multi-device merge. Contact support@bookmark-sync.top.',
      keywords: 'BookmarkSync help,bookmark sync FAQ,bookmark sync support,bookmark sync contact',
    },
  },
  privacy: {
    zh: {
      title: '隐私政策 · BookmarkSync',
      description:
        'BookmarkSync 隐私政策说明：仅收集邮箱与书签数据用于同步，启用 Supabase RLS 行级隔离，不收集浏览历史、不嵌入第三方分析、不分享给第三方。',
      keywords: 'BookmarkSync 隐私,书签同步隐私,书签同步数据安全',
    },
    en: {
      title: 'Privacy Policy · BookmarkSync',
      description:
        'BookmarkSync privacy policy: we collect only email and bookmark data for sync, with Supabase RLS row-level isolation. No browsing history, no third-party analytics, no data sharing.',
      keywords: 'BookmarkSync privacy,bookmark sync privacy,bookmark sync data security',
    },
  },
  terms: {
    zh: {
      title: '服务条款 · BookmarkSync',
      description:
        'BookmarkSync 服务条款：账户、付费档位、订阅、退款政策（7 天无条件退款）、可接受使用、知识产权、免责声明、终止、条款变更、适用法律。',
      keywords: 'BookmarkSync 条款,书签同步服务条款,书签同步退款政策',
    },
    en: {
      title: 'Terms of Service · BookmarkSync',
      description:
        'BookmarkSync Terms of Service: accounts, paid tiers, subscription, refund policy (7-day unconditional), acceptable use, intellectual property, disclaimer, termination.',
      keywords: 'BookmarkSync terms,bookmark sync terms,bookmark sync refund policy',
    },
  },
  notFound: {
    zh: {
      title: '页面不存在 · BookmarkSync',
      description: '你访问的页面不存在或已移动。',
      keywords: '',
    },
    en: {
      title: 'Page not found · BookmarkSync',
      description: 'The page you visited does not exist or has moved.',
      keywords: '',
    },
  },
};

/** 面包屑各段的中英文标签（key = seoKey）。 */
const CRUMB_LABELS: Record<Locale, Record<string, string>> = {
  zh: {
    home: '首页',
    pricing: '定价',
    download: '下载',
    docs: '文章',
    support: '支持',
    privacy: '隐私',
    terms: '条款',
  },
  en: {
    home: 'Home',
    pricing: 'Pricing',
    download: 'Download',
    docs: 'Articles',
    support: 'Support',
    privacy: 'Privacy',
    terms: 'Terms',
  },
};

/** JSON-LD 是任意结构，用宽松类型承载。 */
export type JsonLd = Record<string, unknown>;

export function getOrganizationJsonLd(locale: Locale = 'zh'): JsonLd {
  const isZh = locale === 'zh';
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    email: SITE.email,
    logo: `${SITE.url}/favicon.svg`,
    description: isZh
      ? '跨浏览器书签云同步与备份工具，支持 Chrome / Edge / Firefox。'
      : 'Cross-browser bookmark cloud sync and backup for Chrome, Edge, and Firefox.',
  };
  if (SITE.twitter) data.sameAs = [`https://twitter.com/${SITE.twitter.replace(/^@/, '')}`];
  return data;
}

export function getSoftwareAppJsonLd(locale: Locale = 'zh'): JsonLd {
  const isZh = locale === 'zh';
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: isZh ? '浏览器扩展 / 生产力' : 'BrowserExtension / Productivity',
    operatingSystem: 'Chrome, Edge, Firefox',
    url: SITE.url,
    description: isZh
      ? '跨浏览器书签云同步与备份工具，支持 Chrome / Edge / Firefox 之间书签自动同步。真树同步，文件夹改名/移动不丢子项；精准删除永不复活；多端并发编辑自动收敛、无覆盖写。免费 500 条书签起步。'
      : 'Cross-browser bookmark cloud sync tool. Syncs bookmarks across Chrome, Edge, and Firefox with true-tree sync — renaming or moving folders never loses children — and convergent multi-device merge. Start free with 500 bookmarks.',
    offers: [
      {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        name: 'Free',
        url: `${SITE.url}/pricing`,
      },
      {
        '@type': 'Offer',
        price: '20',
        priceCurrency: 'USD',
        name: 'Plus',
        url: `${SITE.url}/pricing`,
      },
      {
        '@type': 'Offer',
        price: '50',
        priceCurrency: 'USD',
        name: 'Pro',
        url: `${SITE.url}/pricing`,
      },
    ],
  };
  if (SITE.twitter) data.sameAs = [`https://twitter.com/${SITE.twitter.replace(/^@/, '')}`];
  return data;
}

export function getBreadcrumbJsonLd(
  seoKey: string,
  locale: Locale = 'zh',
  leafName?: string,
): JsonLd {
  const labels = CRUMB_LABELS[locale] || CRUMB_LABELS.zh;
  const prefix = locale === 'en' ? '/en' : '';
  const items: { name: string; path: string | null }[] = [
    { name: labels.home, path: `${prefix || ''}/` },
  ];

  if (leafName) {
    // 内容页：首页 → 文章（/docs）→ 文章标题
    items.push({ name: labels.docs, path: `${prefix}/docs` });
    items.push({ name: leafName, path: null });
    return {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        ...(it.path ? { item: `${SITE.url}${it.path}` } : {}),
      })),
    };
  }

  if (seoKey && seoKey !== 'home' && labels[seoKey]) {
    items.push({ name: labels[seoKey], path: `${prefix}/${seoKey}` });
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${SITE.url}${it.path}`,
    })),
  };
}

export function getArticleJsonLd(args: {
  headline: string;
  description: string;
  url: string;
  datePublished?: string;
  dateModified?: string;
  locale?: Locale;
}): JsonLd {
  const { headline, description, url, datePublished, dateModified, locale = 'zh' } = args;
  const data: JsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    url,
    inLanguage: LOCALE_TAGS[locale]?.htmlLang || 'zh-CN',
    author: { '@type': 'Organization', name: SITE.name, url: SITE.url },
    publisher: {
      '@type': 'Organization',
      name: SITE.name,
      url: SITE.url,
      logo: { '@type': 'ImageObject', url: `${SITE.url}/favicon.svg` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
  if (datePublished) data.datePublished = datePublished;
  if (dateModified) data.dateModified = dateModified;
  return data;
}

export function getFaqJsonLd(items: { q: string; a: string }[], url: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
    url,
  };
}
