<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { SITE_UPDATED } from '../lib/site-meta.js';

const { t } = useI18n();

const sections = ['collect', 'store', 'use', 'share', 'delete', 'contact'];

// contact 小节把邮箱包裹成可点击 mailto 链接
const contactBody = computed(() => {
  const email = t('contact.supportEmail');
  const body = t('privacy.sections.contact.body');
  return body.replace(email, `<a href="mailto:${email}" class="privacy-email">${email}</a>`);
});
</script>

<template>
  <div class="privacy-page">
    <section class="section privacy-hero">
      <div class="container container-narrow">
        <p class="section-eyebrow">{{ t('privacy.eyebrow') }}</p>
        <h1 class="section-title">{{ t('privacy.title') }}</h1>
        <p class="privacy-updated">{{ t('privacy.updatedAtPrefix') }} {{ SITE_UPDATED }}</p>
        <p class="privacy-intro">{{ t('privacy.intro') }}</p>
      </div>
    </section>

    <section class="section privacy-body">
      <div class="container container-narrow">
        <div class="privacy-sections">
          <div v-for="key in sections" :key="key" class="privacy-section">
            <h2 class="privacy-h2">{{ t(`privacy.sections.${key}.title`) }}</h2>
            <p v-if="key === 'contact'" class="privacy-p" v-html="contactBody"></p>
            <p v-else class="privacy-p">{{ t(`privacy.sections.${key}.body`) }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.privacy-page {
  display: flex;
  flex-direction: column;
}

.privacy-hero {
  background: var(--color-bg);
  padding-top: var(--space-20);
  padding-bottom: var(--space-12);
  border-bottom: 1px solid var(--color-border);
}

.container-narrow {
  max-width: 720px;
}

.section-eyebrow {
  margin-bottom: var(--space-2);
}

.section-title {
  font-size: var(--text-4xl);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: var(--space-2);
}

.privacy-updated {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-6);
}

.privacy-intro {
  font-size: var(--text-lg);
  color: var(--color-text-soft);
  line-height: 1.65;
}

.privacy-body {
  background: var(--color-bg);
  padding-top: var(--space-12);
}

.privacy-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.privacy-h2 {
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.privacy-p {
  font-size: var(--text-base);
  color: var(--color-text-soft);
  line-height: 1.75;
}

:deep(.privacy-email) {
  color: var(--color-accent);
  text-decoration: underline;
  transition: color var(--transition);
}

:deep(.privacy-email:hover) {
  color: var(--color-accent-hover);
}
</style>
