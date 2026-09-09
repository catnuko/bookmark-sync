<script setup>
import { useI18n } from "vue-i18n";
import { computed } from "vue";
import PricingCard from "../components/PricingCard.vue";
import FAQSection from "../components/sections/FAQSection.vue";

const { t, tm, rt } = useI18n();

const plans = [
  { plan: "free", highlighted: false },
  { plan: "premium", highlighted: true },
];

// 解析 i18n 对比表行，把 boolean / string 都还原成可渲染格式
const compareRows = computed(() =>
  tm("pricing.compare.rows").map((row) => ({
    feature: rt(row.feature),
    free: row.free,
    premium: row.premium,
  }))
);

function isBool(v) {
  return typeof v === "boolean";
}
</script>

<template>
  <div class="pricing-page">
    <section class="section pricing-hero">
      <div class="container">
        <div class="section-header">
          <p class="section-eyebrow">{{ t("pricing.eyebrow") }}</p>
          <h1 class="section-title">{{ t("pricing.title") }}</h1>
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
      </div>
    </section>

    <!-- 完整功能对比表 -->
    <section class="section compare-section">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">{{ t("pricing.compare.title") }}</h2>
        </div>

        <div class="compare-table-wrap">
          <table class="compare-table">
            <thead>
              <tr>
                <th class="col-feature">{{ t("pricing.compare.colFeature") }}</th>
                <th>{{ t("pricing.compare.colFree") }}</th>
                <th class="col-highlight">{{ t("pricing.compare.colPremium") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in compareRows" :key="i">
                <td class="col-feature">{{ row.feature }}</td>
                <td>
                  <span v-if="isBool(row.free) && row.free" class="cell-yes">✓</span>
                  <span v-else-if="isBool(row.free)" class="cell-no">—</span>
                  <span v-else class="cell-text">{{ row.free }}</span>
                </td>
                <td class="col-highlight">
                  <span v-if="isBool(row.premium) && row.premium" class="cell-yes">✓</span>
                  <span v-else-if="isBool(row.premium)" class="cell-no">—</span>
                  <span v-else class="cell-text">{{ row.premium }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="pricing-legal-note">
          {{ t("pricing.legalNote") }}
          <RouterLink to="/terms" class="link">{{ t("nav.terms") }}</RouterLink>
          ·
          <RouterLink to="/privacy" class="link">{{ t("nav.privacy") }}</RouterLink>
        </p>
      </div>
    </section>

    <FAQSection />
  </div>
</template>

<style scoped>
.pricing-page {
  display: flex;
  flex-direction: column;
}

.pricing-hero {
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

.plans-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-5);
  max-width: 720px;
  margin: 0 auto;
  align-items: stretch;
}

.compare-section {
  background: var(--color-bg-soft);
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.compare-table-wrap {
  max-width: 880px;
  margin: 0 auto;
  overflow-x: auto;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.compare-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 560px;
}

.compare-table thead th {
  padding: var(--space-4) var(--space-5);
  text-align: left;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  border-bottom: 1px solid var(--color-border);
}

.compare-table thead .col-highlight {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

.compare-table thead .col-feature {
  color: var(--color-text-muted);
  font-weight: 500;
}

.compare-table tbody td {
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-soft);
  text-align: center;
}

.compare-table tbody td.col-feature {
  color: var(--color-text);
  font-weight: 500;
  text-align: left;
}

.compare-table tbody tr:last-child td {
  border-bottom: none;
}

.compare-table tbody .col-highlight {
  background: var(--color-accent-soft);
}

.cell-yes {
  color: var(--color-accent);
  font-weight: 700;
  font-size: var(--text-base);
}

.cell-no {
  color: var(--color-text-faint);
}

.cell-text {
  color: var(--color-text-soft);
}

.pricing-legal-note {
  text-align: center;
  margin-top: var(--space-6);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

@media (max-width: 900px) {
  .plans-grid {
    grid-template-columns: 1fr;
    max-width: 460px;
  }
}
</style>
