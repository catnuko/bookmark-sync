<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>{{ t("key_e2eBanner") }}</span>
  </div>

  <div class="kp-block">
    <div class="kp-label">{{ t("key_label") }}</div>
    <div class="kp-key" v-if="state.passphraseStored">
      <div class="key-box mono">{{ state.passphraseStored }}</div>
      <button class="icon-btn kp-copy" :title="t('key_copy')" :aria-label="t('key_copy')" @click="copyPhrase"><Icon name="copy" /></button>
    </div>
    <p class="foot">
      {{ t("key_foot") }}
    </p>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { state, loadKeyPanel, copyPhrase } from "../store.js";
import { t } from "../lib/i18n.js";
import Icon from "./ui/Icon.vue";

onMounted(loadKeyPanel);
</script>

<style scoped>
.kp-key { display: flex; gap: 8px; align-items: stretch; }
.key-box {
  flex: 1; padding: 10px 12px; border-radius: 8px;
  background: var(--bg-scrim, rgba(128,128,128,.1));
  word-break: break-all; font-size: 13px;
}
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.kp-copy { flex: 0 0 auto; }
</style>
