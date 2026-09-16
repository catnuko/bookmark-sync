<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>端到端加密（AES-256-GCM）强制开启。密钥仅存于本机，服务器永不接触明文。</span>
  </div>

  <div class="kp-block">
    <div class="kp-label">你的同步密钥</div>
    <div v-if="state.keyValue" class="kp-key">
      <div class="key-box">{{ state.keyValue }}</div>
      <button class="icon-btn kp-copy" :title="'复制密钥'" aria-label="复制密钥" @click="copyKey"><Icon name="copy" /></button>
    </div>
    <div v-else class="banner banner-warning">
      <Icon name="lock" />
      <span>本设备尚无密钥，首次同步时自动生成；换设备时请在此导入同一密钥。</span>
    </div>
    <div v-if="state.keyValue" class="hint">
      <span class="badge badge-success badge-sub">44 字符 · base64</span>
      <span>只读展示，仅可复制</span>
    </div>
  </div>

  <div class="kp-block">
    <div class="kp-label">导入已有密钥</div>
    <div class="kp-row">
      <input
        v-model="state.keyImportInput"
        class="input mono"
        placeholder="粘贴其他设备导出的密钥…"
        autocomplete="off"
        spellcheck="false"
        @keyup.enter="doImportKey"
      />
      <button class="btn btn-secondary" :disabled="!state.keyImportInput" @click="doImportKey">导入</button>
    </div>
    <p class="foot">换设备 / 重装：在旧设备「同步密钥」里复制密钥后粘贴到这里。</p>
  </div>

  <div class="kp-block">
    <div class="kp-label">用口令设定密钥</div>
    <div class="kp-row">
      <input
        v-model="state.keyPhraseInput"
        class="input"
        type="password"
        placeholder="至少 8 位口令"
        autocomplete="new-password"
        @keyup.enter="doSetKeyByPhrase"
      />
      <button class="btn btn-secondary" :disabled="!state.keyPhraseInput" @click="doSetKeyByPhrase">设定</button>
    </div>
    <div class="hint">
      <span class="badge badge-neutral badge-sub">≥8 位</span>
      <span>口令不上传，仅在本机派生密钥</span>
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
      <div style="color:var(--text-secondary);margin-top:2px">服务端无后门、无客服找回、无法重置。请把密钥另存到密码管理器。</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { state, loadKeyPanel, copyKey, doImportKey, doSetKeyByPhrase } from "../store.js";
import Icon from "./ui/Icon.vue";

// 弹窗抽屉打开时 openDrawer('key') 才会调 loadKeyPanel()；设置页的 PaneCrypto 直接嵌本组件、
// 不会触发加载，导致 state.keyValue 为空而显示「没密钥」。改为组件自挂载时加载，两边一致。
onMounted(loadKeyPanel);
</script>
