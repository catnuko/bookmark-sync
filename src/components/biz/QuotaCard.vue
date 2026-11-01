<template>
  <div
    class="rounded-lg bg-card px-3.5 py-3"
    :class="
      quotaState === 'over'
        ? 'bg-destructive-tint shadow-[inset_0_0_0_1px_var(--destructive-border)]'
        : quotaState === 'warn'
          ? 'bg-warning-tint shadow-[inset_0_0_0_1px_var(--warning-border)]'
          : ''
    "
  >
    <div class="mb-2 flex items-center gap-2">
      <Badge :variant="badgeVariant">{{ quotaBadge.text }}</Badge>
      <span class="flex-1"></span>
      <Button
        v-if="quotaBtn === 'upgrade'"
        variant="ghost"
        size="sm"
        :class="
          quotaState === 'over' ? 'bg-primary text-primary-foreground hover:bg-primary/85' : ''
        "
        @click="openUpgrade"
      >
        {{ t('common_upgrade') }}
      </Button>
      <Button v-else variant="ghost" size="sm" @click="manageSubscription">
        {{ t('common_manage') }}
      </Button>
    </div>
    <div class="mb-2 flex items-baseline gap-1.5">
      <template v-if="usedCount == null">
        <span class="text-body-sm text-(--text-secondary-c)">{{ quotaPlaceholder }}</span>
      </template>
      <template v-else>
        <span class="text-title font-semibold">{{ usedCount.toLocaleString() }}</span>
        <span class="text-body-sm text-(--text-secondary-c)">
          {{ quotaCount ? t('quota_countOf', quotaCount.toLocaleString()) : t('quota_unlimited') }}
        </span>
      </template>
    </div>
    <Progress
      v-if="usagePct > 0"
      :model-value="usagePct"
      :class="
        quotaState === 'over'
          ? '[&>div]:bg-destructive'
          : quotaState === 'warn'
            ? '[&>div]:bg-warning'
            : ''
      "
    />
    <div
      class="mt-2 flex items-center gap-1.5 text-caption leading-(--text-caption--line-height)"
      :class="quotaState === 'ok' ? 'text-(--text-secondary-c)' : 'text-(--text-on-tint-secondary)'"
    >
      <span
        class="size-2 flex-none rounded-full"
        :class="quotaState === 'ok' ? 'bg-primary' : 'bg-(--text-quaternary)'"
      ></span>
      {{ quotaFoot }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  usedCount,
  quotaCount,
  usagePct,
  quotaState,
  quotaBadge,
  quotaPlaceholder,
  quotaFoot,
  quotaBtn,
  openUpgrade,
  manageSubscription,
} from '../../store.js';
import { t } from '../../lib/i18n.js';
import Badge from '../ui/badge/Badge.vue';
import Button from '../ui/button/Button.vue';
import Progress from '../ui/progress/Progress.vue';

// store 不可动（返回旧 badge-* 类名），在这里映射成 Badge variant
const BADGE_VARIANTS = {
  'badge-neutral': 'secondary',
  'badge-success': 'success',
  'badge-danger': 'danger',
  'badge-warning': 'warning',
  'badge-info': 'info',
};
const badgeVariant = computed(() => BADGE_VARIANTS[quotaBadge.value.cls] ?? 'secondary');
</script>
