<template>
  <div class="gate-wrap">
    <div class="gate-card">
      <div class="gate-ico"><Icon name="shield" /></div>
      <h2 class="gate-title">{{ state.phraseGateMode === "setup" ? "设置同步口令" : "输入同步口令" }}</h2>
      <p class="gate-sub">
        <template v-if="state.phraseGateMode === 'setup'">
          这是你第一次在这台设备使用。请设置一个同步口令——它是以后解密书签的唯一凭证。
        </template>
        <template v-else>
          云端书签已加密。请输入与其他设备<b>相同的同步口令</b>，验证通过后才能进入。
        </template>
      </p>

      <div class="gate-row">
        <input
          v-model="state.phraseGateInput"
          class="input"
          type="password"
          :placeholder="state.phraseGateMode === 'setup' ? '设置口令（至少 8 位）' : '输入同步口令'"
          autocomplete="new-password"
          :disabled="state.phraseGateBusy"
          @keyup.enter="submitPhraseGate"
        />
        <button class="btn btn-primary" :disabled="!state.phraseGateInput || state.phraseGateBusy" @click="submitPhraseGate">
          {{ state.phraseGateBusy ? "验证中…" : (state.phraseGateMode === "setup" ? "设置并进入" : "验证并进入") }}
        </button>
      </div>

      <p v-if="state.phraseGateMsg" class="gate-err">{{ state.phraseGateMsg }}</p>

      <div class="gate-warn">
        <Icon name="alert" />
        <span>口令一旦设置不可更改。忘记口令将无法解密书签，插件和服务器都无法找回。</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { state, submitPhraseGate } from "../store.js";
import Icon from "./ui/Icon.vue";
</script>

<style scoped>
.gate-wrap {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; padding: 24px; box-sizing: border-box;
}
.gate-card {
  width: 100%; max-width: 360px; text-align: center;
}
.gate-ico {
  width: 56px; height: 56px; margin: 0 auto 16px;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  background: var(--bg-scrim, rgba(128,128,128,.15));
  color: var(--text-primary);
}
.gate-title { margin: 0 0 8px; font-size: 20px; }
.gate-sub { margin: 0 0 20px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.gate-row { display: flex; flex-direction: column; gap: 10px; }
.gate-err { color: var(--danger-text, #d33); margin-top: 12px; font-size: 13px; }
.gate-warn {
  margin-top: 20px; padding: 12px; border-radius: 8px;
  background: var(--bg-scrim, rgba(128,128,128,.1));
  color: var(--text-secondary); font-size: 12px; line-height: 1.6;
  display: flex; gap: 8px; text-align: left;
}
</style>
