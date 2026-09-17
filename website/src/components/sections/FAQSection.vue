<script setup>
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const faqKeys = [
  "upgrade",
  "order",
  "refund",
  "freeLimit",
  "payment",
  "subOrOnetime",
  "passphrase",
  "newDevice",
  "devices",
  "autoSync",
  "gc",
  "quotaUnit",
];
const openIndex = ref(0);

function toggle(i) {
  openIndex.value = openIndex.value === i ? -1 : i;
}
</script>

<template>
  <section class="section section-faq">
    <div class="container">
      <div class="section-header">
        <p class="section-eyebrow">{{ t("pricing.eyebrow") }}</p>
        <h2 class="section-title">{{ t("pricing.faq.title") }}</h2>
      </div>

      <div class="faq-list">
        <div
          v-for="(key, i) in faqKeys"
          :key="key"
          class="faq-item"
          :class="{ open: openIndex === i }"
        >
          <button class="faq-q" @click="toggle(i)">
            <span>{{ t(`pricing.faq.items.${key}.q`) }}</span>
            <svg class="faq-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="faq-a-wrap">
            <p class="faq-a">{{ t(`pricing.faq.items.${key}.a`) }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-faq {
  background: var(--color-bg-soft);
  border-top: 1px solid var(--color-border);
}

.section-header {
  text-align: center;
  margin-bottom: var(--space-12);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.faq-list {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.faq-item {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color var(--transition);
}

.faq-item.open {
  border-color: var(--color-border-strong);
}

.faq-q {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.faq-arrow {
  color: var(--color-text-muted);
  transition: transform var(--transition);
  flex-shrink: 0;
}

.faq-item.open .faq-arrow {
  transform: rotate(180deg);
}

.faq-a-wrap {
  max-height: 0;
  overflow: hidden;
  transition: max-height 300ms var(--ease-out);
}

.faq-item.open .faq-a-wrap {
  max-height: 420px;
}

.faq-a {
  padding: 0 var(--space-5) var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  line-height: 1.65;
}
</style>
