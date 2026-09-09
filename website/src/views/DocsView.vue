<script setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const sections = [
  { key: "quickstart", icon: "M5 12h14M13 6l6 6-6 6" },
  { key: "features", icon: "M9 7H5a2 2 0 00-2 2v8a2 2 0 002 2h4M9 7V3a2 2 0 012-2h6a2 2 0 012 2v18a2 2 0 01-2 2h-6a2 2 0 01-2-2V7z" },
  { key: "faq", icon: "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" },
  { key: "troubleshoot", icon: "M9 14l-5-5 5-5M4 9h11a5 5 0 015 5v0a5 5 0 01-5 5h-5" },
];
</script>

<template>
  <div class="docs-page">
    <section class="section docs-hero">
      <div class="container">
        <div class="section-header">
          <p class="section-eyebrow">{{ t("docs.eyebrow") }}</p>
          <h1 class="section-title">{{ t("docs.title") }}</h1>
          <p class="section-subtitle">{{ t("docs.subtitle") }}</p>
        </div>

        <!-- 即将上线占位 -->
        <div class="coming-card">
          <div class="coming-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p class="coming-text">{{ t("docs.comingSoon") }}</p>
        </div>

        <!-- 目录占位（结构预览） -->
        <div class="docs-grid">
          <div
            v-for="s in sections"
            :key="s.key"
            class="doc-card card"
          >
            <div class="doc-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path :d="s.icon" />
              </svg>
            </div>
            <h3 class="doc-title">{{ t(`docs.sections.${s.key}`) }}</h3>
            <span class="doc-coming">{{ t("common.comingSoon") }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.docs-page {
  display: flex;
  flex-direction: column;
}

.docs-hero {
  background: var(--color-bg);
  padding-top: var(--space-20);
}

.section-header {
  text-align: center;
  margin-bottom: var(--space-16);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.coming-card {
  max-width: 540px;
  margin: 0 auto var(--space-16);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8);
  background: var(--color-bg-soft);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.coming-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text-soft);
}

.coming-text {
  font-size: var(--text-base);
  color: var(--color-text-muted);
  text-align: center;
}

.docs-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.doc-card {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.doc-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-muted);
  color: var(--color-text);
}

.doc-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
}

.doc-coming {
  font-size: var(--text-xs);
  color: var(--color-text-faint);
}

@media (max-width: 1024px) {
  .docs-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .docs-grid {
    grid-template-columns: 1fr;
  }
}
</style>
