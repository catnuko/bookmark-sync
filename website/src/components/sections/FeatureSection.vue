<script setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const features = [
  { key: "sync", accent: false },
  { key: "history", accent: true },
  { key: "quota", accent: false },
  { key: "privacy", accent: false },
  { key: "conflict", accent: false },
  { key: "migration", accent: false },
];

const iconPaths = {
  sync: "M21 12a9 9 0 11-9-9 9 9 0 019 9zM12 7v5l3 3",
  history: "M3 12a9 9 0 109-9 9 9 0 00-9 9zM3 12h5l2-2 2 4 2-2h7",
  quota: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M9 12h6",
  privacy: "M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4zM12 8v4M12 16h.01",
  conflict: "M7 7h10M7 12h10M7 17h6M3 7v10M21 7v10",
  migration: "M5 12h14M13 6l6 6-6 6",
};
</script>

<template>
  <section id="features" class="section section-features">
    <div class="container">
      <div class="section-header">
        <p class="section-eyebrow">{{ t("features.eyebrow") }}</p>
        <h2 class="section-title">{{ t("features.title") }}</h2>
        <p class="section-subtitle">{{ t("features.subtitle") }}</p>
      </div>

      <div class="features-grid">
        <div
          v-for="feature in features"
          :key="feature.key"
          class="feature-card"
          :class="{ 'feature-accent': feature.accent }"
        >
          <div class="feature-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path :d="iconPaths[feature.key]" />
            </svg>
          </div>
          <h3 class="feature-title">{{ t(`features.items.${feature.key}.title`) }}</h3>
          <p class="feature-desc">{{ t(`features.items.${feature.key}.desc`) }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-features {
  background: var(--color-bg);
}

.section-header {
  text-align: center;
  margin-bottom: var(--space-16);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.feature-card {
  background: var(--color-bg);
  padding: var(--space-8);
  transition: background var(--transition);
}

.feature-card:hover {
  background: var(--color-bg-soft);
}

.feature-accent {
  background: var(--color-accent-soft);
}

.feature-accent:hover {
  background: var(--color-accent-soft);
}

.feature-accent .feature-icon {
  background: var(--color-accent);
  color: white;
}

.feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--color-bg-muted);
  color: var(--color-text);
  margin-bottom: var(--space-4);
}

.feature-title {
  font-size: var(--text-base);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: var(--space-2);
}

.feature-desc {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.65;
}

@media (max-width: 1024px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .features-grid {
    grid-template-columns: 1fr;
  }
}
</style>
