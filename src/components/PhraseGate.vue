<template>
  <div class="gate-wrap">
    <div class="gate-card">
      <div class="gate-ico"><Icon name="shield" /></div>
      <h2 class="gate-title">
        {{ state.phraseGateMode === 'setup' ? t('gate_titleSetup') : t('gate_titleVerify') }}
      </h2>
      <p class="gate-sub">
        {{ state.phraseGateMode === 'setup' ? t('gate_hintSetup') : t('gate_hintVerify') }}
      </p>

      <div class="gate-row">
        <input
          v-model="state.phraseGateInput"
          class="input"
          type="password"
          :placeholder="state.phraseGateMode === 'setup' ? t('gate_phSetup') : t('gate_phVerify')"
          autocomplete="new-password"
          :disabled="state.phraseGateBusy"
          @keyup.enter="submitPhraseGate"
        />
        <button
          class="btn btn-primary"
          :disabled="!state.phraseGateInput || state.phraseGateBusy"
          @click="submitPhraseGate"
        >
          {{
            state.phraseGateBusy
              ? t('gate_busy')
              : state.phraseGateMode === 'setup'
                ? t('gate_ctaSetup')
                : t('gate_ctaVerify')
          }}
        </button>
      </div>

      <p v-if="state.phraseGateMsg" class="gate-err">{{ state.phraseGateMsg }}</p>
    </div>
  </div>
</template>

<script setup>
// 口令门禁页（唯一入口）：登录后未设置/未验证口令前，App.vue 不渲染任何主界面。
// setup = 第一台设备设新口令；verify = 其它设备输入既有口令（用云端密文验证）。
import { state, submitPhraseGate } from '../store.js';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';
</script>

<style scoped>
.gate-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  box-sizing: border-box;
}
.gate-card {
  width: 100%;
  max-width: 360px;
  text-align: center;
}
.gate-ico {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-scrim, rgba(128, 128, 128, 0.15));
  color: var(--text-primary);
}
.gate-ico svg {
  width: 26px;
  height: 26px;
}
.gate-title {
  margin: 0 0 8px;
  font-size: 20px;
}
.gate-sub {
  margin: 0 0 20px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.gate-row {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gate-err {
  color: var(--danger-text, #d33);
  margin-top: 12px;
  font-size: 13px;
}
</style>
