<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import LocalizedLink from './LocalizedLink.vue';
import { CONTENT_ROUTES, CONTENT_CATEGORIES } from '../content/manifest';

const { t, locale } = useI18n();

const productLinks = [
  { label: 'nav.features', to: '/#features' },
  { label: 'nav.pricing', to: '/pricing' },
  { label: 'nav.download', to: '/download' },
];

const resourceLinks = [
  { label: 'nav.docs', to: '/docs' },
  { label: 'nav.support', to: '/support' },
];

/**
 * 内容栏目（问题解决 / 迁移指南）—— SEO 的主要抓手。
 *
 * ★ 全站页脚是爬虫抓取页面时**必经**的一处内链，权重传递效率最高。
 *   内容页如果只靠「相关阅读」互相链接，会形成孤岛岛群；挂到页脚才能吃到全站权重。
 *
 * 按当前语言过滤，且每类只取前 3 篇 —— 页脚塞满链接会挤垮移动端布局，
 * 而「内容很多」这件事本身对用户没有价值。
 */
const contentColumns = computed(() => {
  const cur = locale.value === 'en' ? 'en' : 'zh';
  return Object.entries(CONTENT_CATEGORIES)
    .map(([key, cat]) => {
      const links = CONTENT_ROUTES.filter((r) => r.category === key && r.locale === cur)
        .slice(0, 3)
        .map((r) => ({ label: r.title, to: `/${r.prefix}/${r.slug}` }));
      return { label: cat.label[cur], desc: cat.description[cur], links };
    })
    // 内容还没写时不要出现空栏目（会留一个只有标题的空列）
    .filter((c) => c.links.length > 0);
});

const legalLinks = [
  { label: 'nav.privacy', to: '/privacy' },
  { label: 'nav.terms', to: '/terms' },
];
</script>

<template>
  <footer class="footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <LocalizedLink to="/" class="brand">
          <img src="/favicon.svg" alt="BookmarkSync" width="28" height="28" />
          <span class="brand-name">{{ t('brand.name') }}</span>
        </LocalizedLink>
        <p class="footer-tagline">{{ t('footer.tagline') }}</p>
      </div>

      <div class="footer-cols">
        <div class="footer-col">
          <h4 class="footer-title">{{ t('footer.product') }}</h4>
          <LocalizedLink
            v-for="link in productLinks"
            :key="link.label"
            :to="link.to"
            class="footer-link"
          >
            {{ t(link.label) }}
          </LocalizedLink>
        </div>

        <div class="footer-col">
          <h4 class="footer-title">{{ t('footer.resources') }}</h4>
          <LocalizedLink
            v-for="link in resourceLinks"
            :key="link.label"
            :to="link.to"
            class="footer-link"
          >
            {{ t(link.label) }}
          </LocalizedLink>
        </div>

        <!-- 内容栏目（问题解决 / 迁移指南）。SEO 内链的主要通道：
             全站每页都经过页脚，内容页从这里拿到的是全站权重而不是孤岛内的循环权重。 -->
        <div v-for="col in contentColumns" :key="col.label" class="footer-col footer-col-content">
          <h4 class="footer-title">{{ col.label }}</h4>
          <LocalizedLink v-for="link in col.links" :key="link.to" :to="link.to" class="footer-link">
            {{ link.label }}
          </LocalizedLink>
        </div>
      </div>
    </div>

    <div class="container footer-bottom">
      <div class="footer-bottom-left">
        <p class="copyright">{{ t('footer.copyright') }}</p>
        <nav class="legal-links" aria-label="Legal">
          <LocalizedLink v-for="link in legalLinks" :key="link.label" :to="link.to" class="legal-link">
            {{ t(link.label) }}
          </LocalizedLink>
        </nav>
      </div>
      <a :href="`mailto:${t('contact.supportEmail')}`" class="footer-support">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="5"
            width="18"
            height="14"
            rx="2"
            stroke="currentColor"
            stroke-width="1.8"
          />
          <path
            d="M3 7l9 6 9-6"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ t('contact.supportEmail') }}</span>
      </a>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
  padding: var(--space-16) 0 var(--space-8);
}

.footer-inner {
  display: grid;
  grid-template-columns: 1.5fr 2fr;
  gap: var(--space-12);
  padding-bottom: var(--space-12);
}

.footer-brand {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
}

.brand-name {
  font-size: var(--text-base);
}

.footer-tagline {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  max-width: 320px;
  line-height: 1.6;
}

/* 列数随内容栏目数量自适应（auto-fit + minmax）——
   写死2 列的话，加了内容栏目后每列被压到一半宽，长标题会折成三行。 */
.footer-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-8);
}

.footer-col {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.footer-title {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.footer-link {
  font-size: var(--text-sm);
  color: var(--color-text-soft);
  transition: color var(--transition);
}

.footer-link:hover {
  color: var(--color-text);
}

.footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
  flex-wrap: wrap;
}

.footer-bottom-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.legal-links {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.legal-link {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
  transition: color var(--transition);
}

.legal-link:hover {
  color: var(--color-text-muted);
}

.copyright {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

.footer-support {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--color-text-soft);
  transition: color var(--transition);
}

.footer-support:hover {
  color: var(--color-text);
}

@media (max-width: 768px) {
  .footer-inner {
    grid-template-columns: 1fr;
    gap: var(--space-8);
  }
  .footer-cols {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-4);
  }
}

@media (max-width: 480px) {
  .footer-cols {
    /* 单列而非两列：内容页标题很长（可达 20+ 字），两列会让每行只剩一两个字。
       宁可页面长一点，也不要出现「一列一个字」的观感。 */
    grid-template-columns: 1fr;
  }
}
</style>
