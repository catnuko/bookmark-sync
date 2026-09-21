<template>
  <section class="pane active">
    <h2>{{ t('account_title') }}</h2>
    <p class="pane-sub">{{ t('account_sub') }}</p>

    <div class="grp">
      <div class="inset-group">
        <div class="inset-row" style="min-height: 64px">
          <span class="avatar">{{ initial }}</span>
          <div class="r-main">
            <div class="r-title">{{ displayName }}</div>
            <div class="r-sub">{{ userEmail }}</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="logout">
            {{ t('account_logout') }}
          </button>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="check-circle" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('account_plan') }}</div>
            <div class="r-sub">{{ planFoot }}</div>
          </div>
          <span class="badge" :class="planBadgeCls">{{ planLabel }}</span>
          <button class="btn btn-ghost btn-sm" @click="openUpgrade">
            {{ t('common_upgrade') }}
          </button>
        </div>
      </div>
      <p class="foot">{{ t('account_foot') }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import {
  state,
  userEmail,
  displayName,
  planLabel,
  logout,
  openUpgrade,
  quotaCount,
  usedCount,
} from '../store.js';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';

const initial = computed(() => (userEmail.value ? userEmail.value[0].toUpperCase() : '?'));

const planBadgeCls = computed(() => {
  const p = state.profile?.plan;
  if (p === 'pro' || p === 'lifetime') return 'badge-neutral';
  if (p === 'plus' || p === 'premium') return 'badge-neutral';
  return 'badge-neutral';
});

const planFoot = computed(() => {
  if (quotaCount.value == null) return t('account_planFootUnlimited');
  return t(
    'account_planFoot',
    quotaCount.value.toLocaleString(),
    (usedCount.value ?? 0).toLocaleString(),
  );
});
</script>
