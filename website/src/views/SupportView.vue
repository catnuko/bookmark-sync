<script setup>
import { useI18n } from 'vue-i18n';
import { SITE } from '../seo/config.js';
import LocalizedLink from '../components/LocalizedLink.vue';

const { t } = useI18n();

const faqKeys = [
  'account',
  'browsers',
  'free',
  'restore',
  'security',
  'passphrase',
  'conflict',
  'gc',
  'accountBar',
];

const resourceLinks = [
  { key: 'docs', to: '/docs' },
  { key: 'privacy', to: '/privacy' },
  { key: 'terms', to: '/terms' },
];
</script>

<template>
  <div class="support-page">
    <section class="section support-hero">
      <div class="container container-narrow">
        <p class="section-eyebrow">{{ t('support.eyebrow') }}</p>
        <h1 class="section-title">{{ t('support.title') }}</h1>
        <p class="support-intro">{{ t('support.intro') }}</p>

        <a class="support-email-card" :href="`mailto:${SITE.email}`">
          <span class="email-label">{{ t('support.contact.title') }}</span>
          <span class="email-value">{{ SITE.email }}</span>
          <span class="email-note">{{ t('support.contact.note') }}</span>
        </a>
      </div>
    </section>

    <section class="section support-faq">
      <div class="container container-narrow">
        <h2 class="support-h2">{{ t('support.faq.title') }}</h2>
        <p class="support-subtitle">{{ t('support.faq.subtitle') }}</p>

        <div class="faq-list">
          <details v-for="key in faqKeys" :key="key" class="faq-item">
            <summary class="faq-q">{{ t(`support.faq.items.${key}.q`) }}</summary>
            <p class="faq-a">{{ t(`support.faq.items.${key}.a`) }}</p>
          </details>
        </div>
      </div>
    </section>

    <section class="section support-resources">
      <div class="container container-narrow">
        <h2 class="support-h2">{{ t('support.resources.title') }}</h2>
        <p class="support-subtitle">{{ t('support.resources.desc') }}</p>
        <div class="resource-links">
          <LocalizedLink
            v-for="link in resourceLinks"
            :key="link.key"
            :to="link.to"
            class="resource-link"
          >
            {{ t(`support.resources.items.${link.key}`) }}
          </LocalizedLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.support-page {
  display: flex;
  flex-direction: column;
}

.support-hero {
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
  margin-bottom: var(--space-3);
}

.support-intro {
  font-size: var(--text-lg);
  color: var(--color-text-muted);
  margin-bottom: var(--space-8);
}

.support-email-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background: var(--color-bg-soft);
  text-decoration: none;
  transition: border-color var(--transition);
}

.support-email-card:hover {
  border-color: var(--color-accent);
}

.email-label {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.email-value {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-text);
}

.email-note {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.support-faq {
  background: var(--color-bg);
  padding-top: var(--space-16);
  padding-bottom: var(--space-12);
}

.support-h2 {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: var(--space-2);
}

.support-subtitle {
  color: var(--color-text-muted);
  margin-bottom: var(--space-8);
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.faq-item {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-soft);
  padding: var(--space-4) var(--space-5);
}

.faq-item[open] {
  border-color: var(--color-accent);
}

.faq-q {
  font-size: var(--text-base);
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}

.faq-q::-webkit-details-marker {
  display: none;
}

.faq-a {
  margin-top: var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--text-base);
  line-height: 1.7;
}

.support-resources {
  background: var(--color-bg-soft);
  padding-top: var(--space-16);
  padding-bottom: var(--space-20);
}

.resource-links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.resource-link {
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  font-weight: 600;
  text-decoration: none;
  transition:
    border-color var(--transition),
    color var(--transition);
}

.resource-link:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
