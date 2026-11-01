<template>
  <section class="max-w-[620px]">
    <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t('crypto_title') }}</h2>
    <p class="mt-1 text-body-sm text-(--text-secondary-c)">{{ t('crypto_sub') }}</p>

    <div class="mt-[22px]">
      <KeyPanel />
    </div>
  </section>
</template>

<script setup>
import { t } from '../lib/i18n.js';
import KeyPanel from './biz/KeyPanel.vue';
</script>
