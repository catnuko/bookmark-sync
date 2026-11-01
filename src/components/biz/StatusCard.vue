<template>
  <div
    class="flex items-center gap-2.5 rounded-lg bg-card px-3 py-2.5"
    :class="
      syncState === 'error'
        ? 'bg-destructive-tint shadow-[inset_0_0_0_1px_var(--destructive-border)]'
        : ''
    "
  >
    <span class="grid size-[22px] flex-none place-items-center" :class="iconCls">
      <LoaderCircle v-if="syncState === 'syncing'" class="animate-spin" :stroke-width="1.75" />
      <CircleCheck v-else-if="syncState === 'ok'" :stroke-width="1.75" />
      <CircleAlert v-else-if="syncState === 'error'" :stroke-width="1.75" />
      <CloudOff v-else :stroke-width="1.75" />
    </span>
    <div class="min-w-0 flex-1">
      <div class="text-body font-semibold leading-(--text-title--line-height)">
        {{ syncTitle }}
      </div>
      <div
        class="text-body-sm leading-(--text-body-sm--line-height)"
        :class="
          syncState === 'error' ? 'text-(--text-on-tint-secondary)' : 'text-(--text-secondary-c)'
        "
      >
        {{ syncSub }}
      </div>
    </div>
    <Button v-if="syncState === 'error'" variant="ghost" size="sm" @click="syncNow()">
      {{ t('common_retry') }}
    </Button>
    <span
      v-else
      class="min-w-0 shrink basis-auto text-right text-body-sm text-(--text-secondary-c) [overflow-wrap:anywhere]"
      >{{ syncTail }}</span
    >
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { CircleCheck, CircleAlert, CloudOff, LoaderCircle } from '@lucide/vue';
import { syncNow, syncState, syncTitle, syncSub, syncTail } from '../../store.js';
import { t } from '../../lib/i18n.js';
import Button from '../ui/button/Button.vue';

const iconCls = computed(() => {
  switch (syncState.value) {
    case 'syncing':
      return 'text-info';
    case 'error':
      return 'text-destructive-text';
    case 'ok':
      return 'text-success-text';
    default:
      return 'text-tertiary';
  }
});
</script>
