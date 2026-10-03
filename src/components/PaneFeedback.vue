<template>
  <section class="pane active">
    <h2 v-if="!bare">{{ t('feedback_title') }}</h2>
    <FeedbackForm bare />
  </section>
</template>

<script setup>
// 「反馈」独立面板：popup 里由抽屉标题承载标题（bare），设置页里由 h2 承载。
import { t } from '../lib/i18n.js';
import FeedbackForm from './FeedbackForm.vue';

defineProps({ bare: { type: Boolean, default: false } });
</script>
