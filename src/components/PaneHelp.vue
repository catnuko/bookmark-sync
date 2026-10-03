<template>
  <section class="pane active">
    <template v-if="!bare">
      <h2>{{ t('common_help') }}</h2>
      <p class="pane-sub">{{ t('help_sub') }}</p>
    </template>

    <div class="grp">
      <div class="acc">
        <div v-for="(item, i) in items" :key="i" class="acc-item" :class="{ open: openIdx === i }">
          <button type="button" class="acc-head" @click="openIdx = openIdx === i ? -1 : i">
            <span class="acc-t">{{ item.title }}</span>
            <Icon class="chev" name="chevron-right" />
          </button>
          <div class="acc-body">
            <div class="acc-inner" v-html="item.body"></div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';

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
.acc-inner table.help-tbl {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: var(--fs-secondary);
}
.acc-inner table.help-tbl th,
.acc-inner table.help-tbl td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border-strong, rgba(128, 128, 128, 0.2));
  vertical-align: top;
}
.acc-inner table.help-tbl th {
  color: var(--text-primary);
  font-weight: var(--fw-semibold, 600);
}
.acc-inner table.help-tbl td:first-child {
  white-space: nowrap;
  color: var(--text-primary);
}
</style>
