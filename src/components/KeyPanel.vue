<template>
  <div class="banner banner-info">
    <Icon name="shield" />
    <span>书签同步<b>强制端到端加密</b>：每一条书签操作都在设备上加密后上传，服务器只保存密文。忘记密钥 = 数据无法找回（无客服、无后门）。</span>
  </div>

  <div class="grp">
    <h4>你的同步密钥</h4>
    <template v-if="state.keyValue">
      <div class="key-box">
        <span class="key-text">{{ state.keyValue }}</span>
        <button class="icon-btn" :title="'复制密钥'" aria-label="复制密钥" @click="copyKey"><Icon name="copy" /></button>
      </div>
      <p class="foot mono" style="margin-top:6px">44 字符 · base64 · 只读展示，仅可复制</p>
    </template>
    <div v-else class="banner banner-warning">
      <Icon name="lock" />
      <span>本设备尚无密钥，首次同步时自动生成；换设备时请在此导入同一密钥。</span>
    </div>
  </div>

  <div class="grp">
    <h4>导入已有密钥</h4>
    <div class="inset-group">
      <div class="inset-row">
        <input
          v-model="state.keyImportInput"
          class="input mono"
          placeholder="从其他设备复制的密钥（44 字符）"
          autocomplete="off"
          spellcheck="false"
          @keyup.enter="doImportKey"
        />
        <button class="btn btn-secondary btn-sm" :disabled="!state.keyImportInput" @click="doImportKey">导入</button>
      </div>
    </div>
    <p class="foot">换设备 / 重装：在旧设备「同步密钥」里复制密钥后粘贴到这里。</p>
  </div>

  <div class="grp">
    <h4>用口令设定密钥</h4>
    <div class="inset-group">
      <div class="inset-row">
        <input
          v-model="state.keyPhraseInput"
          class="input"
          type="password"
          placeholder="同一句口令（至少 8 位）"
          autocomplete="new-password"
          @keyup.enter="doSetKeyByPhrase"
        />
        <button class="btn btn-secondary btn-sm" :disabled="!state.keyPhraseInput" @click="doSetKeyByPhrase">设定</button>
      </div>
    </div>
    <p class="foot">新装一台设备时，输入同一口令即可解密同步数据。口令不上传，仅在本机派生密钥。</p>
  </div>

  <div v-if="state.keyMsg" class="banner banner-success">
    <Icon name="check-circle" />
    <span>{{ state.keyMsg }}</span>
  </div>

  <div class="banner banner-danger">
    <Icon name="alert" />
    <span><b>请牢记口令 / 保管好密钥。</b>插件和服务器都无法找回——忘记口令将无法解密既有数据，等同于数据丢失。</span>
  </div>
</template>

<script setup>
import { state, copyKey, doImportKey, doSetKeyByPhrase } from "../store.js";
import Icon from "./ui/Icon.vue";
</script>
