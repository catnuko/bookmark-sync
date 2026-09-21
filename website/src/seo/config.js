/**
 * SEO 配置中心
 * - 站点级常量
 * - 路由级 SEO 文案（中英双语，按 locale 切换）
 * - JSON-LD 结构化数据
 *
 * 设计意图：把所有 SEO 文案集中在一处，便于维护、便于翻译、便于增量补充。
 */

export const SITE = {
  // 部署上线后改为你的真实域名
  url: 'https://www.bookmark-sync.top',
  name: 'BookmarkSync',
  defaultLocale: 'zh',
  locales: ['zh', 'en'],
  // 用于面包屑 / og:site_name
  shortName: 'BookmarkSync',
  // 用于 og:image 和 twitter:image（1200×630 JPEG，已生成在 public/）
  ogImage: 'https://www.bookmark-sync.top/og-image.jpg',
  // 客服邮箱（与 i18n 的 contact.supportEmail 同步）
  email: 'support@bookmark-sync.top',
  // 社交账号（可选，留空则不输出）
  twitter: '@bookmarksync',
};

/**
 * 路由级 SEO 文案
 * 每个路由一份，包含 zh / en 两个 locale 的 title + description + keywords
 */
export const ROUTE_SEO = {
  home: {
    zh: {
      title: 'BookmarkSync · 跨浏览器书签同步与备份工具',
      description:
        '跨浏览器书签云同步工具，支持 Chrome / Edge / Firefox 之间书签自动同步、多设备一致与跨设备迁移。真树结构，文件夹改名/移动不丢子项；精准删除永不复活；多端自动合并不覆盖。免费 500 条书签起步，Plus / Pro 按年订阅解锁更多条数。',
      keywords:
        '书签同步,书签备份,跨浏览器书签,Chrome 书签同步,Edge 书签同步,Firefox 书签同步,书签云同步,书签多设备同步,书签迁移,文件夹改名不丢子项',
    },
    en: {
      title: 'BookmarkSync · Cross-browser bookmark sync & backup',
      description:
        'Cross-browser bookmark cloud sync tool. Syncs bookmarks across Chrome, Edge, and Firefox with true-tree sync — renaming or moving folders never loses children — precise, tombstone-based deletes that never resurrect, and automatic multi-device merge. Start free with 500 bookmarks; Plus and Pro are yearly subscriptions for more.',
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
      title: '使用文档 · BookmarkSync',
      description:
        'BookmarkSync 使用文档：快速开始、功能详解、常见问题、故障排查。所有关于书签同步工具的疑问，在这里找到答案。',
      keywords: 'BookmarkSync 文档,书签同步教程,书签同步使用,书签同步 FAQ',
    },
    en: {
      title: 'Documentation · BookmarkSync',
      description:
        'BookmarkSync documentation: quick start, feature deep-dive, FAQ, troubleshooting. Find every answer about the bookmark sync tool here.',
      keywords: 'BookmarkSync docs,bookmark sync tutorial,bookmark sync usage,bookmark sync FAQ',
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
};

/**
 * Organization JSON-LD：用于品牌知识图谱 / 富搜索结果
 */
export function getOrganizationJsonLd(locale = 'zh') {
  const isZh = locale === 'zh';
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    email: SITE.email,
    logo: `${SITE.url}/favicon.svg`,
    description: isZh
      ? '跨浏览器书签云同步与备份工具。'
      : 'Cross-browser bookmark cloud sync and backup.',
    sameAs: [],
  };
}

/**
 * SoftwareApplication JSON-LD：用于在搜索结果中显示产品富片段（评分 / 价格 / 平台）
 */
export function getSoftwareAppJsonLd(locale = 'zh') {
  const isZh = locale === 'zh';
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: isZh ? '浏览器扩展 / 生产力' : 'BrowserExtension / Productivity',
    operatingSystem: 'Chrome, Edge, Firefox',
    url: SITE.url,
    description: isZh
      ? '跨浏览器书签云同步与备份工具，支持 Chrome / Edge / Firefox 之间书签自动同步。真树结构同步，文件夹改名/移动不丢子项；精准删除永不复活；多端自动合并不覆盖。免费 500 条书签起步。'
      : 'Cross-browser bookmark cloud sync tool. Syncs bookmarks across Chrome, Edge, and Firefox with true-tree sync — renaming or moving folders never loses children. Start free with 500 bookmarks.',
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
}

/**
 * BreadcrumbList JSON-LD：面包屑，用于富搜索结果显示路径
 */
export function getBreadcrumbJsonLd(path, locale = 'zh') {
  const isZh = locale === 'zh';
  const labels = {
    zh: {
      home: '首页',
      pricing: '定价',
      download: '下载',
      docs: '文档',
      privacy: '隐私',
      terms: '条款',
      support: '支持',
    },
    en: {
      home: 'Home',
      pricing: 'Pricing',
      download: 'Download',
      docs: 'Docs',
      privacy: 'Privacy',
      terms: 'Terms',
      support: 'Support',
    },
  };
  const seg = path.split('/').filter(Boolean);
  const items = [{ name: labels[locale].home, path: '/' }];
  if (seg.length && seg[0] !== '' && labels[locale][seg[0]]) {
    items.push({ name: labels[locale][seg[0]], path: `/${seg[0]}` });
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
