<template>
  <section class="max-w-[620px]">
    <template v-if="!bare">
      <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t('common_help') }}</h2>
      <p class="mt-1 text-body-sm text-(--text-secondary-c)">{{ t('help_sub') }}</p>
    </template>

    <div class="mt-[22px]">
      <Accordion :items="items" />
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';
import { t } from '../lib/i18n.js';
import Accordion from './ui/accordion/Accordion.vue';

defineProps({ bare: { type: Boolean, default: false } });

const openIdx = ref(-1);

// 帮助条目全文（含 HTML）存放在 _locales/*/messages.json（help_n_title / help_n_body）
const items = computed(() =>
  Array.from({ length: 7 }, (_, i) => ({
    title: t(`help_${i + 1}_title`),
    body: t(`help_${i + 1}_body`),
  })),
);
</script>

<style>
/* 帮助条目内嵌表格（i18n 带 <table class="help-tbl">），全局样式承接（规范 §4.1） */
table.help-tbl {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}
table.help-tbl th,
table.help-tbl td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
table.help-tbl th {
  color: var(--foreground);
  font-weight: 600;
}
table.help-tbl td:first-child {
  white-space: nowrap;
  color: var(--foreground);
}
</style>
