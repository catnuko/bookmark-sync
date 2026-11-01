<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <div class="w-full max-w-[360px] text-center" data-test="phrase-gate">
      <div
        class="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-scrim text-foreground"
      >
        <ShieldCheck class="size-[26px]" :stroke-width="1.75" />
      </div>
      <h2 class="mb-2 text-[20px] font-semibold" data-test="phrase-title">
        {{ state.phraseGateMode === 'setup' ? t('gate_titleSetup') : t('gate_titleVerify') }}
      </h2>
      <p class="mb-5 text-body-sm leading-relaxed text-(--text-secondary-c)">
        {{ state.phraseGateMode === 'setup' ? t('gate_hintSetup') : t('gate_hintVerify') }}
      </p>

      <div class="flex flex-col gap-2.5">
        <Input
          v-model="state.phraseGateInput"
          type="password"
          :placeholder="state.phraseGateMode === 'setup' ? t('gate_phSetup') : t('gate_phVerify')"
          autocomplete="new-password"
          :disabled="state.phraseGateBusy"
          @keyup.enter="submitPhraseGate"
        />
        <Button
          data-test="phrase-cta"
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
        </Button>
      </div>

      <p
        v-if="state.phraseGateMsg"
        class="mt-3 text-body-sm text-destructive-text"
        data-test="phrase-err"
      >
        {{ state.phraseGateMsg }}
      </p>
    </div>
  </div>
</template>

<script setup>
// 口令门禁页（唯一入口）：登录后未设置/未验证口令前，App.vue 不渲染任何主界面。
// setup = 第一台设备设新口令；verify = 其它设备输入既有口令（用云端密文验证）。
import { ShieldCheck } from '@lucide/vue';
import { state, submitPhraseGate } from '../store.js';
import { t } from '../lib/i18n.js';
import Button from './ui/button/Button.vue';
import Input from './ui/input/Input.vue';
</script>
