<template>
  <Dialog v-model:open="dialogOpen">
    <DialogContent data-test="upgrade-modal">
      <DialogIcon kind="info">
        <ShieldCheck class="size-[22px]" :stroke-width="1.75" />
      </DialogIcon>
      <DialogTitle class="text-center text-title-lg font-semibold tracking-[-0.02em]">
        {{ t('upgrade_title') }}
      </DialogTitle>
      <DialogDescription
        class="mt-2 text-center text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c)"
      >
        {{ t('upgrade_body', (usedCount ?? 0).toLocaleString()) }}
      </DialogDescription>

      <div class="mt-4 flex flex-col gap-2">
        <PlanCard name="Plus" price="$20" :features="plusFeatures" data-test="plan-plus">
          <Button
            class="mt-3 w-full"
            variant="secondary"
            :disabled="state.checkoutBusy"
            @click="startCheckout('plus')"
          >
            {{ state.checkoutBusy ? t('checkout_busy') : t('plan_subPlus') }}
          </Button>
        </PlanCard>

        <PlanCard name="Pro" price="$50" :features="proFeatures" reco data-test="plan-pro">
          <Button class="mt-3 w-full" :disabled="state.checkoutBusy" @click="startCheckout('pro')">
            {{ state.checkoutBusy ? t('checkout_busy') : t('plan_subPro') }}
          </Button>
        </PlanCard>
      </div>

      <div class="mt-4 flex gap-2">
        <Button variant="ghost" class="flex-1" @click="dialogOpen = false">
          {{ t('upgrade_later') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { computed } from 'vue';
import { ShieldCheck } from '@lucide/vue';
import { DialogContent, DialogDescription, DialogTitle } from 'reka-ui';
import { state, startCheckout, usedCount } from '../store.js';
import { t } from '../lib/i18n.js';
import Dialog from './ui/dialog/Dialog.vue';
import Button from './ui/button/Button.vue';
import DialogIcon from './biz/DialogIcon.vue';
import PlanCard from './biz/PlanCard.vue';

const dialogOpen = computed({
  get: () => state.showUpgradeModal,
  set: (v) => (state.showUpgradeModal = v),
});

const plusFeatures = computed(() => [
  t('plan_plusFeat1'),
  t('plan_plusFeat2'),
  t('plan_plusDevices'),
]);
const proFeatures = computed(() => [t('plan_proFeat1'), t('plan_proFeat2'), t('plan_proDevices')]);
</script>
