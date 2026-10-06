/**
 * useSEO composable —— 路由级 head 管理（唯一 head 写入点）
 *
 * 在 App.vue 顶层调用一次即可。所有响应式由内部处理：
 *   - 路由变化 → meta.seoKey / route.path 自动响应 → 重新设置 SEO
 *   - 语言切换 → URL 前缀变化 → locale 自动响应 → title/description/og/canonical 同步切换
 *
 * 输出：
 *   - 当前路由的 title / description / keywords
 *   - canonical（指向当前 locale 的独立 URL）
 *   - hreflang alternate（zh / en / x-default，指向**不同** URL）
 *   - robots：公开页 index+follow；404 与后台 noindex
 *   - Organization + SoftwareApplication + BreadcrumbList（+ FAQPage）JSON-LD
 */
import { computed, inject } from 'vue';
import { useHead } from '@unhead/vue';
import { useRoute } from 'vue-router';
import { SITE, LOCALE_TAGS, ROUTE_SEO, getOrganizationJsonLd, getSoftwareAppJsonLd, getBreadcrumbJsonLd } from './config';
import { pathForLocale } from '../router/routes';

export function useSEO() {
  const route = useRoute();

  // 内容页（markdown 驱动）在 SSG 时注入自己的 SEO 文案。
  // ★ 为什么走 inject 而不是查表：内容页的 title/description 来自每篇文章的
  //   frontmatter，没有 key 也不该有 key（它们不属于 ROUTE_SEO 那一套固定文案）。
  //   inject 在 CSR 下为 undefined → 自然回落到路由 seoKey，dev 直开也能用。
  const override = inject('contentSeoOverride', null);

  // ★ 语言以 URL 为准，而不是 i18n 的 locale。
  // 直接打开 /en/pricing 时用户记忆可能是 zh，i18n 会被设成 zh；
  // 但 SEO 文案必须跟 canonical 自洽（canonical 是 /en/pricing 就得配英文文案），
  // 否则爬虫看到「英文 URL + 中文 title」。
  const seoLocale = computed(() =>
    route.path === '/en' || route.path.startsWith('/en/') ? 'en' : 'zh',
  );

  // 当前路由对应的 SEO 文案（按 URL 语言切换，回退到默认语言）
  const seo = computed(() => {
    if (override) {
      return {
        title: override.title,
        description: override.description,
        keywords: override.keywords || '',
      };
    }
    const config = ROUTE_SEO[route.meta.seoKey] || ROUTE_SEO.home;
    return config[seoLocale.value] || config[SITE.defaultLocale];
  });

  const seoKey = computed(() => route.meta.seoKey || 'home');
  const isNoindex = computed(() => route.meta.noindex === true || route.meta.admin === true);

  // canonical：去掉 hash 与尾斜杠（根路径除外）
  const canonicalPath = computed(() => {
    const p = route.path.replace(/#.*$/, '');
    return p === '/' ? '/' : p.replace(/\/$/, '');
  });
  const canonicalUrl = computed(() => `${SITE.url}${canonicalPath.value}`);

  // hreflang：zh / en 各自指向**真实不同的**URL，x-default 指向中文。
  // ★ 内容页优先用注入的 localePaths（同一 slug 的另一语言页）——
  //   用 pathForLocale 反推在 slug 变化时会指向不存在的 URL。
  const alternates = computed(() => {
    if (override?.localePaths) {
      const links = [];
      for (const loc of SITE.locales) {
        const p = override.localePaths[loc];
        if (p) links.push({ rel: 'alternate', hreflang: LOCALE_TAGS[loc].hreflang, href: `${SITE.url}${p}` });
      }
      const xd = override.localePaths[SITE.defaultLocale];
      if (xd) links.push({ rel: 'alternate', hreflang: 'x-default', href: `${SITE.url}${xd}` });
      return links;
    }
    const links = SITE.locales.map((loc) => ({
      rel: 'alternate',
      hreflang: LOCALE_TAGS[loc].hreflang,
      href: `${SITE.url}${pathForLocale(canonicalPath.value, loc)}`,
    }));
    links.push({
      rel: 'alternate',
      hreflang: 'x-default',
      href: `${SITE.url}${pathForLocale(canonicalPath.value, SITE.defaultLocale)}`,
    });
    return links;
  });

  const ogLocale = computed(() => LOCALE_TAGS[seoLocale.value].og);
  const ogLocaleAlternate = computed(() =>
    seoLocale.value === 'zh' ? LOCALE_TAGS.en.og : LOCALE_TAGS.zh.og,
  );

  const robots = computed(() =>
    isNoindex.value
      ? 'noindex, nofollow'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
  );

  useHead(() => ({
    title: seo.value.title,
    meta: [
      { name: 'description', content: seo.value.description },
      ...(seo.value.keywords ? [{ name: 'keywords', content: seo.value.keywords }] : []),
      { name: 'author', content: SITE.name },
      { name: 'robots', content: robots.value },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE.name },
      { property: 'og:title', content: seo.value.title },
      { property: 'og:description', content: seo.value.description },
      { property: 'og:url', content: canonicalUrl.value },
      { property: 'og:locale', content: ogLocale.value },
      { property: 'og:locale:alternate', content: ogLocaleAlternate.value },
      { property: 'og:image', content: SITE.ogImage },
      // ★ 尺寸必须与 public/og-image.jpg 实际像素一致（当前 2560×1440）。
      //   声明与实物不符时部分平台（LinkedIn/Slack）会按声明尺寸缩放后再裁剪，
      //   结果是分享卡片糊掉或主体被切。
      { property: 'og:image:width', content: '2560' },
      { property: 'og:image:height', content: '1440' },
      { property: 'og:image:type', content: 'image/jpeg' },
      { property: 'og:image:alt', content: `${SITE.name} · ${seo.value.title}` },
      // Twitter Card
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: seo.value.title },
      { name: 'twitter:description', content: seo.value.description },
      { name: 'twitter:image', content: SITE.ogImage },
      { name: 'twitter:image:alt', content: `${SITE.name} · ${seo.value.title}` },
      ...(SITE.twitter ? [{ name: 'twitter:site', content: SITE.twitter }] : []),
    ],
    link: [
      // ★ 404 页不出canonical。它没有对应内容可指，写 canonical 等于告诉 Google
      //   「把 /404 当成正式页面」，反而可能让它被索引。
      ...(isNoindex.value ? [] : [{ rel: 'canonical', href: canonicalUrl.value }]),
      ...alternates.value,
    ],
    script: [
      { type: 'application/ld+json', innerHTML: JSON.stringify(getOrganizationJsonLd(seoLocale.value)) },
      { type: 'application/ld+json', innerHTML: JSON.stringify(getSoftwareAppJsonLd(seoLocale.value)) },
      { type: 'application/ld+json', innerHTML: JSON.stringify(getBreadcrumbJsonLd(seoKey.value, seoLocale.value, override?.breadcrumbLeaf)) },
    ],
    htmlAttrs: {
      lang: computed(() => LOCALE_TAGS[seoLocale.value].htmlLang),
    },
  }));
}