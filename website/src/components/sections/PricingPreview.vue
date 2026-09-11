<script setup>
import { useI18n } from "vue-i18n";
import PricingCard from "../PricingCard.vue";

const { t } = useI18n();

const plans = [
  { plan: "free", highlighted: false },
  { plan: "plus", highlighted: true },
  { plan: "pro", highlighted: false },
];
</script>

<template>
  <section id="pricing" class="section section-pricing-preview">
    <div class="container">
      <div class="section-header">
        <p class="section-eyebrow">{{ t("pricing.eyebrow") }}</p>
        <h2 class="section-title">{{ t("pricing.title") }}</h2>
        <p class="section-subtitle">{{ t("pricing.subtitle") }}</p>
      </div>

      <div class="plans-grid">
        <PricingCard
          v-for="p in plans"
          :key="p.plan"
          :plan="p.plan"
          :highlighted="p.highlighted"
        />
      </div>

      <div class="pricing-more">
        <RouterLink to="/pricing" class="link">
          {{ t("common.viewAll") }}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="margin-left: 4px; vertical-align: -2px;">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-pricing-preview {
  background: var(--color-bg);
}

.section-header {
  text-align: center;
  margin-bottom: var(--space-16);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.plans-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
  max-width: 1080px;
  margin: 0 auto;
  align-items: stretch;
}

.pricing-more {
  text-align: center;
  margin-top: var(--space-10);
  font-size: var(--text-sm);
}

@media (max-width: 900px) {
  .plans-grid {
    grid-template-columns: 1fr;
    max-width: 460px;
  }
}
</style>
