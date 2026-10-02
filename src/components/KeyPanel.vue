<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>{{ t('key_e2eBanner') }}</span>
  </div>

  <div class="kp-block">
    <div class="kp-label">{{ t('key_label') }}</div>
    <div class="kp-key" v-if="state.passphraseStored">
      <div class="key-box mono">{{ revealed ? state.passphraseStored : masked }}</div>
      <button
        class="icon-btn kp-eye"
        :title="t(revealed ? 'key_hide' : 'key_reveal')"
        :aria-label="t(revealed ? 'key_hide' : 'key_reveal')"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <Icon :name="revealed ? 'eye-off' : 'eye'" />
      </button>
      <button
        class="icon-btn kp-copy"
        :title="t('key_copy')"
        :aria-label="t('key_copy')"
        @click="copyPhrase"
      >
        <Icon name="copy" />
      </button>
    </div>
    <p class="foot">
      {{ t('key_foot') }}
    </p>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { state, loadKeyPanel, copyPhrase } from '../store.js';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';

onMounted(loadKeyPanel);

// 口令默认掩码显示：这个面板可能在他人可见的屏幕上被打开（屏幕共享 / 截图 / 旁边有人），
// 明文太容易被直接读走。点小眼睛才揭示；「复制」不受影响（复制的是真值）。
// 组件随抽屉 / 面板重建，故每次打开都回到隐藏态。
const revealed = ref(false);
const masked = computed(() => '*'.repeat(state.passphraseStored.length));
</script>

<style scoped>
.kp-key {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.key-box {
  flex: 1;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-scrim, rgba(128, 128, 128, 0.1));
  word-break: break-all;
  font-size: 13px;
}
.mono {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.kp-eye,
.kp-copy {
  flex: 0 0 auto;
}
</style>
