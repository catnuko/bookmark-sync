<script setup>
// 语言切换 = **跳转到对应语言的 URL**，不是原地换文案。
//
// 为什么：canonical 与 hreflang 只有在两种语言各有独立 URL 时才成立。
// 原地 toggle 会让 /pricing 这一个 URL 同时代表中英两种内容 → Google 只能索引一种，
// 另一种被判重复。跳转后 URL 变成 /en/pricing，是可索引的独立页面。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { i18n, setLocale } from '../i18n';
import { pathForLocale } from '../router/routes';

const { t, locale } = useI18n();
const router = useRouter();

const next = computed(() => (locale.value === 'zh' ? 'en' : 'zh'));
const nextLabel = computed(() => (next.value === 'en' ? 'English' : '中文'));

function switchLocale() {
  // 先改 i18n 再跳转：目标语言文案立刻生效，不必等路由异步解析完成
  setLocale(i18n, next.value);
  router.push(pathForLocale(router.currentRoute.value.path, next.value));
}
</script>

<template>
  <button class="lang-toggle" :title="t('lang.switch')" @click="switchLocale">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
      <path
        d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"
        stroke="currentColor"
        stroke-width="2"
      />
    </svg>
    <span class="lang-label">{{ nextLabel }}</span>
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