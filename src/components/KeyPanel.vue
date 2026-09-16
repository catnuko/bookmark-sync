<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>端到端加密（AES-256-GCM）强制开启。书签只在本机加密后上传，服务器只存密文。</span>
  </div>

  <div class="kp-block">
    <div class="kp-label">同步口令</div>
    <div v-if="state.hasKeyNow" class="banner banner-success">
      <Icon name="check-circle" />
      <span>本设备已设置同步口令。新设备登录后输入同一口令即可同步。</span>
    </div>
    <div v-else class="banner banner-warning">
      <Icon name="lock" />
      <span>本设备还没有同步口令，设置后才能开始同步。</span>
    </div>

    <div class="kp-row">
      <input
        v-model="state.keyPhraseInput"
        class="input"
        type="password"
        :placeholder="state.hasKeyNow ? '输入新口令（至少 8 位）以更换' : '设置同步口令（至少 8 位）'"
        autocomplete="new-password"
        @keyup.enter="doSetKeyByPhrase"
      />
      <button class="btn btn-secondary" :disabled="!state.keyPhraseInput" @click="doSetKeyByPhrase">
        {{ state.hasKeyNow ? '更换口令' : '设置口令' }}
      </button>
    </div>
    <div class="hint">
      <span class="badge badge-neutral badge-sub">≥8 位</span>
      <span>口令不上传服务器，仅在本机派生密钥；新设备输入同一口令即可同步</span>
    </div>
  </div>

  <div v-if="state.keyMsg" class="banner banner-success">
    <Icon name="check-circle" />
    <span>{{ state.keyMsg }}</span>
  </div>

  <div class="banner banner-danger">
    <Icon name="alert" />
    <div>
      <strong style="color:var(--danger-text)">忘记口令 = 数据永久丢失</strong>
      <div style="color:var(--text-secondary);margin-top:2px">服务端无后门、无客服找回、无法重置。请把口令另存到密码管理器。</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { state, loadKeyPanel, doSetKeyByPhrase } from "../store.js";
import Icon from "./ui/Icon.vue";

onMounted(loadKeyPanel);
</script>
