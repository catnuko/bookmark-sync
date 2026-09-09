<script setup>
import { useI18n } from "vue-i18n";
import { toggleLocale } from "../i18n";

const { t, locale } = useI18n();
</script>

<template>
  <button
    class="lang-toggle"
    :title="t('lang.switch')"
    @click="toggleLocale"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" stroke="currentColor" stroke-width="2" />
    </svg>
    <span class="lang-label">{{ locale === 'zh' ? 'EN' : '中' }}</span>
  </button>
</template>

<style scoped>
.lang-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border-radius: var(--radius-md);
  color: var(--color-text-soft);
  font-size: var(--text-xs);
  font-weight: 500;
  transition: all var(--transition);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.lang-toggle:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
  background: var(--color-bg-soft);
}

.lang-label {
  letter-spacing: 0.02em;
}
</style>
