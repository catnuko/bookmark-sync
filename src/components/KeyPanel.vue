<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>端到端加密（AES-256-GCM）强制开启。书签只在本机加密后上传，服务器只存密文。</span>
  </div>

  <div class="kp-block">
    <div class="kp-label">同步口令</div>
    <div class="banner banner-success">
      <Icon name="check-circle" />
      <span>本设备已设置同步口令。新设备登录后输入同一口令即可同步。</span>
    </div>
    <p class="foot">口令一旦设置不可更改。忘记口令将无法解密书签，且无法找回。</p>
  </div>

  <div class="kp-block" v-if="state.keyValue">
    <div class="kp-label">当前密钥（只读）</div>
    <div class="kp-key">
      <div class="key-box">{{ state.keyValue }}</div>
      <button class="icon-btn kp-copy" title="复制密钥" aria-label="复制密钥" @click="copyKey"><Icon name="copy" /></button>
    </div>
    <div class="hint">
      <span class="badge badge-success badge-sub">44 字符 · base64</span>
      <span>由口令派生，仅本机可见，可复制备份</span>
    </div>
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
import { state, loadKeyPanel, copyKey } from "../store.js";
import Icon from "./ui/Icon.vue";

onMounted(loadKeyPanel);
</script>
