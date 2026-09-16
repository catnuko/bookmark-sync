<template>
  <div class="overlay" @click.self="skipOnboard">
    <div class="modal">
      <div class="m-ico info"><Icon name="shield" /></div>
      <div class="m-title">设置同步口令</div>
      <p class="m-body">
        书签同步<b>强制端到端加密</b>（AES-256-GCM）。请设置一个同步口令——它是解密云端书签的唯一凭证。
      </p>

      <div class="m-stack">
        <input
          v-model="state.onboardPhraseInput"
          class="input"
          type="password"
          placeholder="口令（至少 8 位）"
          autocomplete="new-password"
          @keyup.enter="onboardSetPhrase"
        />
        <button class="btn btn-primary" :disabled="!state.onboardPhraseInput" @click="onboardSetPhrase">设置口令并继续</button>
      </div>

      <p class="m-body" style="margin-top:14px">
        如果这不是你的第一台设备，请输入与其他设备<b>相同的口令</b>，即可同步已有书签。
      </p>

      <div class="m-note banner banner-warning">
        <Icon name="alert" />
        <span><b>请牢记口令。</b>插件和服务器都无法找回——忘记口令将无法解密既有数据，等同于数据丢失。</span>
      </div>
      <div class="m-note banner banner-info">
        <Icon name="folder" />
        <span>🦊 <b>Firefox 提醒：</b>Firefox 有原生「书签菜单」位置（星标默认存放），扩展会在 Chrome 书签栏下创建同名文件夹承接同步；删除它只会清空内容、文件夹会自动恢复。详见「帮助」。</span>
      </div>
      <p v-if="state.onboardMsg" class="hint" style="margin-top:10px;justify-content:center">{{ state.onboardMsg }}</p>
    </div>
  </div>
</template>

<script setup>
import { state, onboardSetPhrase, skipOnboard } from "../store.js";
import Icon from "./ui/Icon.vue";
</script>
