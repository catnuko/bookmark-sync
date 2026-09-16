<template>
  <div class="overlay" @click.self="skipOnboard">
    <div class="modal">
      <div class="m-ico info"><Icon name="phone" /></div>
      <div class="m-title">这是一台新设备</div>
      <p class="m-body">
        书签同步<b>强制端到端加密</b>（AES-256-GCM）。请选择一种方式设定同步密钥——这是解密云端书签的唯一凭证。
      </p>

      <!-- 选择导入 / 口令后的输入区 -->
      <template v-if="state.onboardMode === 'key'">
        <div class="m-stack">
          <input
            v-model="state.onboardKeyInput"
            class="input mono"
            placeholder="从其他设备复制的密钥（44 字符）"
            autocomplete="off"
            spellcheck="false"
            @keyup.enter="onboardImportKey"
          />
          <button class="btn btn-primary" :disabled="!state.onboardKeyInput" @click="onboardImportKey">导入</button>
        </div>
      </template>
      <template v-else-if="state.onboardMode === 'phrase'">
        <div class="m-stack">
          <input
            v-model="state.onboardPhraseInput"
            class="input"
            type="password"
            placeholder="同一句口令（至少 8 位）"
            autocomplete="new-password"
            @keyup.enter="onboardSetPhrase"
          />
          <button class="btn btn-primary" :disabled="!state.onboardPhraseInput" @click="onboardSetPhrase">设定</button>
        </div>
      </template>

      <div class="m-stack">
        <button class="btn btn-secondary" @click="state.onboardMode = state.onboardMode === 'key' ? '' : 'key'">导入已有密钥</button>
        <button class="btn btn-secondary" @click="state.onboardMode = state.onboardMode === 'phrase' ? '' : 'phrase'">用口令设定</button>
        <button class="btn btn-ghost" @click="skipOnboard">跳过（全新使用，同步时自动生成）</button>
      </div>

      <div class="m-note banner banner-warning">
        <Icon name="alert" />
        <span><b>请牢记口令 / 保管好密钥。</b>插件和服务器都无法找回——忘记口令将无法解密既有数据，等同于数据丢失。</span>
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
import { state, onboardImportKey, onboardSetPhrase, skipOnboard } from "../store.js";
import Icon from "./ui/Icon.vue";
</script>
