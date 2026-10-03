<template>
  <section class="pane active">
    <h2>{{ t('sync_title') }}</h2>
    <p class="pane-sub">{{ t('sync_sub') }}</p>

    <div class="grp">
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="sync" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('sync_auto') }}</div>
            <div class="r-sub">{{ t('sync_autoSub') }}</div>
          </div>
          <span class="badge badge-success badge-sub">{{ t('common_enabled') }}</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="list" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('sync_conflict') }}</div>
            <div class="r-sub">{{ t('sync_conflictSub') }}</div>
          </div>
          <span class="badge badge-neutral badge-sub">{{ t('sync_builtin') }}</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="refresh" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('sync_now') }}</div>
            <div class="r-sub">
              {{
                t('sync_lastSync', fmtRelative(state.lastSyncAt), (usedCount ?? 0).toLocaleString())
              }}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" :disabled="state.syncBusy" @click="syncNow()">
            <span v-if="state.syncBusy" class="spinner" />
            {{ state.syncBusy ? t('sync_syncing') : t('sync_do') }}
          </button>
        </div>
      </div>
      <p class="foot">{{ t('sync_foot') }}</p>
    </div>
  </section>
</template>

<script setup>
import { state, syncNow, fmtRelative, usedCount } from '../store.js';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';
</script>
