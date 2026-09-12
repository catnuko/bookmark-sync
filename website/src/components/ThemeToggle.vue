<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { toggleTheme } from "../theme";

const { t } = useI18n();

const isDark = computed(() => {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.theme === "dark";
});
</script>

<template>
  <button
    class="theme-toggle"
    :title="t('theme.switch')"
    :aria-label="t('theme.switch')"
    @click="toggleTheme"
  >
    <!-- 太阳：深色模式下点击切回浅色 -->
    <svg v-if="isDark" width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="2" />
      <path
        d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
    <!-- 月亮：浅色模式下点击切入深色 -->
    <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  color: var(--color-text-soft);
  transition: all var(--transition);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.theme-toggle:hover {
  color: var(--color-text);
  border-color: var(--color-border-strong);
  background: var(--color-bg-soft);
}
</style>
