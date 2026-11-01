<template>
  <section class="max-w-[620px]">
    <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t('sync_title') }}</h2>
    <p class="mt-1 text-body-sm text-(--text-secondary-c)">{{ t('sync_sub') }}</p>

    <div class="mt-[22px]">
      <ListGroup>
        <ListRow>
          <template #leading>
            <RefreshCw :stroke-width="1.75" />
          </template>
          <div class="min-w-0 flex-1">
            <div class="text-body font-medium">{{ t('sync_auto') }}</div>
            <div class="text-body-sm text-(--text-secondary-c)">{{ t('sync_autoSub') }}</div>
          </div>
          <Badge variant="success">{{ t('common_enabled') }}</Badge>
        </ListRow>
        <ListRow>
          <template #leading>
            <List :stroke-width="1.75" />
          </template>
          <div class="min-w-0 flex-1">
            <div class="text-body font-medium">{{ t('sync_conflict') }}</div>
            <div class="text-body-sm text-(--text-secondary-c)">{{ t('sync_conflictSub') }}</div>
          </div>
          <Badge variant="secondary">{{ t('sync_builtin') }}</Badge>
        </ListRow>
        <ListRow>
          <template #leading>
            <LoaderCircle v-if="state.syncBusy" class="animate-spin" :stroke-width="1.75" />
            <RefreshCw v-else :stroke-width="1.75" />
          </template>
          <div class="min-w-0 flex-1">
            <div class="text-body font-medium">{{ t('sync_now') }}</div>
            <div class="text-body-sm text-(--text-secondary-c)">
              {{
                t('sync_lastSync', fmtRelative(state.lastSyncAt), (usedCount ?? 0).toLocaleString())
              }}
            </div>
          </div>
          <Button :disabled="state.syncBusy" size="sm" @click="syncNow()">
            {{ state.syncBusy ? t('sync_syncing') : t('sync_do') }}
          </Button>
        </ListRow>
      </ListGroup>
      <p
        class="mt-2 ml-3 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)"
      >
        {{ t('sync_foot') }}
      </p>
    </div>
  </section>
</template>

<script setup>
import { List, LoaderCircle, RefreshCw } from '@lucide/vue';
import { state, syncNow, fmtRelative, usedCount } from '../store.js';
import { t } from '../lib/i18n.js';
import Badge from './ui/badge/Badge.vue';
import Button from './ui/button/Button.vue';
import ListGroup from './biz/ListGroup.vue';
import ListRow from './biz/ListRow.vue';
</script>
