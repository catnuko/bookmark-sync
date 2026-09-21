<template>
  <section class="pane active">
    <h2>{{ t('crypto_title') }}</h2>
    <p class="pane-sub">{{ t('crypto_sub') }}</p>

    <div class="grp">
      <KeyPanel />
    </div>
  </section>
</template>

<script setup>
import { t } from '../lib/i18n.js';
import KeyPanel from './KeyPanel.vue';
</script>
