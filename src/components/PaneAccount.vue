<template>
  <section class="pane active">
    <template v-if="!bare">
      <h2>{{ t('account_title') }}</h2>
      <p class="pane-sub">{{ t('account_sub') }}</p>
    </template>

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
        <!-- 二级入口：只在 popup 抽屉里出现（bare）。设置页有自己的左侧导航，
             且 openDrawer 只驱动 popup 的抽屉，在那里点了不会有反应。 -->
        <button v-if="bare" type="button" class="inset-row clickable" @click="openDrawer('spaces')">
          <span class="lede"><Icon name="monitor" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('spaces_title') }}</span></span
          >
          <span class="sc-tail">{{
            t('popup_spacesDevices', state.spaces.length, state.devices.length)
          }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button v-if="bare" type="button" class="inset-row clickable" @click="openDrawer('key')">
          <span class="lede"><Icon name="lock" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('popup_keyRow') }}</span></span
          >
          <span class="badge" :class="state.hasKeyNow ? 'badge-success' : 'badge-warning'">{{
            state.hasKeyNow ? t('popup_keyReady') : t('popup_keyTodo')
          }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
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
  openDrawer,
  quotaCount,
  usedCount,
} from '../store.js';
import { t } from '../lib/i18n.js';
import Icon from './ui/Icon.vue';

defineProps({ bare: { type: Boolean, default: false } });

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
