<template>
  <div class="overlay" @click.self="state.showUpgradeModal = false">
    <div class="modal">
      <div class="m-ico info"><Icon name="shield" /></div>
      <div class="m-title">{{ t('upgrade_title') }}</div>
      <p class="m-body">{{ t('upgrade_body', (usedCount ?? 0).toLocaleString()) }}</p>

      <div class="m-stack">
        <div class="plan-card">
          <div class="pc-top">
            <span class="pc-name">Plus</span>
            <span class="pc-price"
              >$20<small>{{ t('plan_perYear') }}</small></span
            >
          </div>
          <ul>
            <li><Icon name="check" />{{ t('plan_plusFeat1') }}</li>
            <li><Icon name="check" />{{ t('plan_plusFeat2') }}</li>
            <li><Icon name="check" />{{ t('plan_plusDevices') }}</li>
          </ul>
          <button
            class="btn btn-secondary"
            style="width: 100%; margin-top: 12px"
            :disabled="state.checkoutBusy"
            @click="startCheckout('plus')"
          >
            {{ state.checkoutBusy ? t('checkout_busy') : t('plan_subPlus') }}
          </button>
        </div>

        <div class="plan-card reco">
          <div class="pc-top">
            <span class="pc-name">Pro</span>
            <span class="badge badge-success badge-sub">{{ t('plan_reco') }}</span>
            <span class="pc-price"
              >$50<small>{{ t('plan_perYear') }}</small></span
            >
          </div>
          <ul>
            <li><Icon name="check" />{{ t('plan_proFeat1') }}</li>
            <li><Icon name="check" />{{ t('plan_proFeat2') }}</li>
            <li><Icon name="check" />{{ t('plan_proDevices') }}</li>
          </ul>
          <button
            class="btn btn-primary"
            style="width: 100%; margin-top: 12px"
            :disabled="state.checkoutBusy"
            @click="startCheckout('pro')"
          >
            {{ state.checkoutBusy ? t('checkout_busy') : t('plan_subPro') }}
          </button>
        </div>
      </div>

      <div class="m-actions">
        <button class="btn btn-ghost" @click="state.showUpgradeModal = false">
          {{ t('upgrade_later') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { state, startCheckout, usedCount } from '../store.js';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';
</script>
