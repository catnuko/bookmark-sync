<script setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const sections = [
  "service",
  "accounts",
  "plans",
  "refund",
  "acceptable",
  "ip",
  "disclaimer",
  "termination",
  "changes",
  "governing",
  "contact",
];
</script>

<template>
  <div class="terms-page">
    <section class="section terms-hero">
      <div class="container container-narrow">
        <p class="section-eyebrow">{{ t("terms.eyebrow") }}</p>
        <h1 class="section-title">{{ t("terms.title") }}</h1>
        <p class="terms-updated">{{ t("terms.updatedAt") }}</p>
        <p class="terms-intro">{{ t("terms.intro") }}</p>
      </div>
    </section>

    <section class="section terms-body">
      <div class="container container-narrow">
        <div class="terms-sections">
          <div
            v-for="key in sections"
            :key="key"
            class="terms-section"
          >
            <h2 class="terms-h2">{{ t(`terms.sections.${key}.title`) }}</h2>
            <p class="terms-p">{{ t(`terms.sections.${key}.body`) }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.terms-page {
  display: flex;
  flex-direction: column;
}

.terms-hero {
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

.terms-updated {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  margin-bottom: var(--space-6);
}

.terms-intro {
  font-size: var(--text-lg);
  color: var(--color-text-soft);
  line-height: 1.65;
}

.terms-body {
  background: var(--color-bg);
  padding-top: var(--space-12);
}

.terms-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.terms-h2 {
  font-size: var(--text-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--color-border);
}

.terms-p {
  font-size: var(--text-base);
  color: var(--color-text-soft);
  line-height: 1.75;
}
</style>
