<script setup>
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

// 三家商店均已上架，卡片直达商店详情页
const browsers = [
  {
    key: 'chrome',
    color: '#4285F4',
    url: 'https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml',
  },
  {
    key: 'edge',
    color: '#0078D7',
    url: 'https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah',
  },
  {
    key: 'firefox',
    color: '#FF7139',
    url: 'https://addons.mozilla.org/zh-CN/firefox/addon/bookmark-sync-app/',
  },
];

// 浏览器图标统一用一个简洁的圆形书签符号，颜色用品牌色区分
const iconPaths = {
  chrome: 'M12 2a10 10 0 11-5 18.66L9 13l3-1V2zM12 2v10l9-3M3 22l9-9',
  edge: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 3a6 6 0 00-6 6c0 4 3 5 6 5s6 1 6 5a6 6 0 00-6-12z',
  firefox: 'M12 2C8 2 5 5 5 9c0 4 3 7 7 7s7-3 7-7',
};
</script>

<template>
  <section id="browsers" class="section section-browsers">
    <div class="container">
      <div class="section-header">
        <p class="section-eyebrow">{{ t('browsers.eyebrow') }}</p>
        <h2 class="section-title">{{ t('browsers.title') }}</h2>
        <p class="section-subtitle">{{ t('browsers.subtitle') }}</p>
      </div>

      <div class="browser-grid">
        <a
          v-for="b in browsers"
          :key="b.key"
          :href="b.url"
          target="_blank"
          rel="noopener"
          class="browser-card card card-hover"
        >
          <div class="browser-icon" :style="{ background: b.color }">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="iconPaths[b.key]" />
            </svg>
          </div>
          <div class="browser-info">
            <h3 class="browser-name">{{ t(`browsers.${b.key}.name`) }}</h3>
            <p class="browser-store">{{ t(`browsers.${b.key}.desc`) }}</p>
          </div>
          <div class="browser-action">
            <span class="browser-cta">{{ t('download.cta') }}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M7 17L17 7M17 7H8M17 7v9"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-browsers {
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

.browser-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
}

.browser-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  background: var(--color-bg);
  cursor: pointer;
}

.browser-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  flex-shrink: 0;
}

.browser-info {
  flex: 1;
  min-width: 0;
}

.browser-name {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: 2px;
}

.browser-store {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.browser-action {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
}

.browser-cta {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
}

@media (max-width: 768px) {
  .browser-grid {
    grid-template-columns: 1fr;
  }
}
</style>
