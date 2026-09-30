<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const pains = [
  { key: 'lost', icon: 'lost' },
  { key: 'crossBrowser', icon: 'browser' },
  { key: 'migration', icon: 'device' },
  { key: 'history', icon: 'history' },
  { key: 'mixed', icon: 'mixed' },
  { key: 'lock', icon: 'lock' },
];

const icons = {
  lost: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  browser: 'M3 9h18M9 21V9M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z',
  device:
    'M9 7H5a2 2 0 00-2 2v8a2 2 0 002 2h4M9 7V3a2 2 0 012-2h6a2 2 0 012 2v18a2 2 0 01-2 2h-6a2 2 0 01-2-2V7z',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8m0-5v5h5M12 7v5l4 2',
  mixed: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  lock: 'M12 17v-3m0-8V4a1 1 0 00-1-1H9a1 1 0 00-1 1v2M7 8h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2z',
};
</script>

<template>
  <section id="pain" class="section section-pain">
    <div class="container">
      <div class="section-header">
        <p class="section-eyebrow">{{ t('pain.eyebrow') }}</p>
        <h2 class="section-title">{{ t('pain.title') }}</h2>
        <p class="section-subtitle">{{ t('pain.subtitle') }}</p>
      </div>

      <div class="pain-grid">
        <div v-for="pain in pains" :key="pain.key" class="card card-hover pain-card">
          <div class="pain-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="icons[pain.icon]" />
            </svg>
          </div>
          <h3 class="pain-title">{{ t(`pain.items.${pain.key}.title`) }}</h3>
          <p class="pain-desc">{{ t(`pain.items.${pain.key}.desc`) }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-pain {
  background: var(--color-bg-soft);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.section-header {
  text-align: center;
  margin-bottom: var(--space-16);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pain-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
}

.pain-card {
  padding: var(--space-6);
  text-align: left;
  background: var(--color-bg);
}

.pain-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  background: var(--color-bg-muted);
  color: var(--color-text);
  margin-bottom: var(--space-4);
}

.pain-title {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-2);
  letter-spacing: -0.01em;
}

.pain-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.6;
}

@media (max-width: 1024px) {
  .pain-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .pain-grid {
    grid-template-columns: 1fr;
  }
}
</style>
