<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>端到端加密（AES-256-GCM）强制开启。书签只在本机加密后上传，服务器只存密文。</span>
  </div>

  <div class="kp-block">
    <div class="kp-label">同步口令（本机保存，仅查看）</div>
    <div class="kp-key" v-if="state.passphraseStored">
      <div class="key-box mono">{{ state.passphraseStored }}</div>
      <button class="icon-btn kp-copy" title="复制口令" aria-label="复制口令" @click="copyPhrase"><Icon name="copy" /></button>
    </div>
    <p class="foot">
      口令仅保存在本机，不上传云端。换设备时输入同一口令即可同步。
      口令一旦设置不可更改，忘记后将无法解密书签。
    </p>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { state, loadKeyPanel, copyPhrase } from "../store.js";
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
