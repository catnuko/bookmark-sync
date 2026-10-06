<script setup>
// 404 页：渲染真正的 noindex 页面，而不是 redirect 回首页。
// 软 404（重定向到 '/'）会被 Google 判定为「与首页重复」，拉低全站质量。
import { useI18n } from 'vue-i18n';
import LocalizedLink from '../components/LocalizedLink.vue';

const { t } = useI18n();

const links = [
  { key: 'nav.home', path: '/' },
  { key: 'nav.pricing', path: '/pricing' },
  { key: 'nav.download', path: '/download' },
  { key: 'nav.docs', path: '/docs' },
  { key: 'nav.support', path: '/support' },
];
</script>

<template>
  <div class="nf">
    <div class="container container-narrow nf-inner">
      <p class="nf-code">404</p>
      <h1 class="nf-title">{{ t('common.notFound.title') }}</h1>
      <p class="nf-desc">{{ t('common.notFound.desc') }}</p>
      <div class="nf-actions">
        <LocalizedLink to="/" class="btn btn-primary">
          {{ t('common.backToHome') }}
        </LocalizedLink>
      </div>
      <nav class="nf-links" :aria-label="t('common.notFound.title')">
        <LocalizedLink v-for="l in links" :key="l.key" :to="l.path" class="nf-link">
          {{ t(l.key) }}
        </LocalizedLink>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.nf {
  display: flex;
  align-items: center;
  min-height: 60vh;
  padding: var(--space-16) 0;
}

.nf-inner {
  text-align: center;
}

.nf-code {
  font-size: 5rem;
  font-weight: 700;
  line-height: 1;
  color: var(--color-text-faint);
  letter-spacing: -0.04em;
}

.nf-title {
  margin-top: var(--space-6);
  font-size: var(--text-2xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.nf-desc {
  margin-top: var(--space-3);
  color: var(--color-text-muted);
}

.nf-actions {
  margin-top: var(--space-8);
  display: flex;
  justify-content: center;
}

.nf-links {
  margin-top: var(--space-10);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-6);
}

.nf-link {
  font-size: var(--text-sm);
  color: var(--color-text-soft);
}

.nf-link:hover {
  color: var(--color-text);
}
</style>
