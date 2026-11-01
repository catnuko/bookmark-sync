<template>
  <section class="max-w-[620px]">
    <h2 v-if="!bare" class="text-[22px] font-semibold tracking-[-0.02em]">
      {{ t('feedback_title') }}
    </h2>
    <FeedbackForm :bare="true" />
  </section>
</template>

<script setup>
// 「反馈」独立面板：popup 里由抽屉标题承载标题（bare），设置页里由 h2 承载。
import { t } from '../lib/i18n.js';
import FeedbackForm from './biz/FeedbackForm.vue';

defineProps({ bare: { type: Boolean, default: false } });
</script>
