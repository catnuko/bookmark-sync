<template>
  <div
    class="rounded-lg p-3.5 bg-card shadow-[inset_0_0_0_1px_var(--border-subtle)]"
    :class="reco ? 'bg-background shadow-[inset_0_0_0_1.5px_var(--primary)]' : ''"
  >
    <div class="flex items-center gap-2">
      <span class="text-title font-semibold">{{ name }}</span>
      <Badge v-if="reco" variant="secondary">{{ t('plan_reco') }}</Badge>
      <span class="ml-auto font-mono text-title font-semibold">
        {{ price }}<small class="font-sans text-caption font-normal text-(--text-secondary-c)">{{ t('plan_perYear') }}</small>
      </span>
    </div>
    <ul class="mt-2.5 flex flex-col gap-1.5">
      <li
        v-for="(feat, i) in features"
        :key="i"
        class="flex items-start gap-2 text-body-sm text-(--text-secondary-c)"
      >
        <Check class="mt-0.5 size-4 flex-none text-success-text" :stroke-width="1.75" />
        {{ feat }}
      </li>
    </ul>
    <slot />
  </div>
</template>

<script setup>
import { Check } from '@lucide/vue';
import { t } from '../../lib/i18n.js';
import Badge from '../ui/badge/Badge.vue';

// 订阅方案卡（旧 .plan-card）：reco 态主色内描边 + 「推荐」徽标，价格 mono
defineProps({
  name: { type: String, required: true },
  price: { type: String, required: true },
  features: { type: Array, required: true },
  reco: { type: Boolean, default: false },
});
</script>
