/**
 * useSEO composable
 *
 * 在 App.vue 顶层调用一次即可。所有响应式由内部处理：
 *   - 路由变化 → route.name / route.path 自动响应 → 重新设置 SEO
 *   - 语言切换 → locale 自动响应 → title/description/og 同步切换
 *
 * 输出：
 *   - 当前路由的 title / description / keywords
 *   - canonical / og / twitter card
 *   - Organization + SoftwareApplication + BreadcrumbList JSON-LD
 */
import { computed } from 'vue';
import { useHead } from '@unhead/vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  SITE,
  ROUTE_SEO,
  getOrganizationJsonLd,
  getSoftwareAppJsonLd,
  getBreadcrumbJsonLd,
} from './config';

export function useSEO() {
  const route = useRoute();
  const { locale } = useI18n();

  // 当前路由对应的 SEO 文案（按 locale 切换，回退到默认 locale）
  const seo = computed(() => {
    const name = route.name || 'home';
    const config = ROUTE_SEO[name] || ROUTE_SEO.home;
    return config[locale.value] || config[SITE.defaultLocale];
  });

  // canonical URL：去除 hash，统一末尾不带斜杠（除根路径）
  const canonicalUrl = computed(() => {
    const path = route.path.replace(/\/$/, '') || '/';
    return `${SITE.url}${path === '/' ? '/' : path}`;
  });

  // 当前 locale 的 BCP 47 标签
  const ogLocale = computed(() => (locale.value === 'zh' ? 'zh_CN' : 'en_US'));

  useHead(() => ({
    title: seo.value.title,
    meta: [
      { name: 'description', content: seo.value.description },
      { name: 'keywords', content: seo.value.keywords },
      { name: 'author', content: SITE.name },
      { name: 'robots', content: 'index, follow, max-image-preview:large' },
      // Open Graph
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: SITE.name },
      { property: 'og:title', content: seo.value.title },
      { property: 'og:description', content: seo.value.description },
      { property: 'og:url', content: canonicalUrl.value },
      { property: 'og:locale', content: ogLocale.value },
      { property: 'og:locale:alternate', content: locale.value === 'zh' ? 'en_US' : 'zh_CN' },
      { property: 'og:image', content: SITE.ogImage },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      // Twitter Card
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: seo.value.title },
      { name: 'twitter:description', content: seo.value.description },
      { name: 'twitter:image', content: SITE.ogImage },
      ...(SITE.twitter ? [{ name: 'twitter:site', content: SITE.twitter }] : []),
    ],
    link: [{ rel: 'canonical', href: canonicalUrl.value }],
    script: [
      {
        type: 'application/ld+json',
        // JSON-LD 必须序列化为字符串
        innerHTML: JSON.stringify(getOrganizationJsonLd(locale.value)),
      },
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(getSoftwareAppJsonLd(locale.value)),
      },
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(getBreadcrumbJsonLd(route.path, locale.value)),
      },
    ],
    htmlAttrs: {
      lang: computed(() => (locale.value === 'zh' ? 'zh-CN' : 'en')),
    },
  }));
}
