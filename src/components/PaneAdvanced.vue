<template>
  <section class="pane active">
    <template v-if="!bare">
      <h2>{{ t('adv_title') }}</h2>
      <p class="pane-sub">{{ t('adv_sub') }}</p>
    </template>

    <div class="grp">
      <h4>{{ t('adv_coexist') }}</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="globe" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('adv_row1Title') }}</div>
            <div class="r-sub">{{ t('adv_row1Sub') }}</div>
          </div>
          <span class="badge badge-neutral badge-sub">{{ t('adv_independent') }}</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="check-circle" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('adv_row2Title') }}</div>
            <div class="r-sub">{{ t('adv_row2Sub') }}</div>
          </div>
          <span class="badge badge-success badge-sub">{{ t('adv_safe') }}</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="alert" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('adv_row3Title') }}</div>
            <div class="r-sub">{{ t('adv_row3Sub') }}</div>
          </div>
          <span class="badge badge-warning badge-sub">{{ t('adv_advice') }}</span>
        </div>
      </div>
    </div>

    <div class="grp">
      <h4>{{ t('adv_maintain') }}</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="folder" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('adv_gcTitle') }}</div>
            <div class="r-sub">{{ t('adv_gcSub') }}</div>
          </div>
          <span class="badge" :class="state.lastGcAt ? 'badge-success' : 'badge-neutral'">{{
            state.lastGcAt ? t('adv_gcDone') : t('adv_gcNone')
          }}</span>
        </div>
      </div>
      <p class="foot">{{ t('adv_gcFoot') }}</p>
    </div>

    <div class="grp">
      <h4>{{ t('adv_local') }}</h4>
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="sync" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('sync_auto') }}</div>
            <div class="r-sub">{{ t('sync_autoSub') }}</div>
          </div>
          <SwitchToggle
            :model-value="state.autoSync"
            :aria-label="t('sync_auto')"
            @update:model-value="toggleAutoSync"
          />
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="alert" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('errreport_title') }}</div>
            <div class="r-sub">{{ t('errreport_sub') }}</div>
          </div>
          <SwitchToggle
            :model-value="state.errorReport"
            :aria-label="t('errreport_title')"
            @update:model-value="toggleErrorReport"
          />
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="log-out" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('account_logout') }}</div>
            <div class="r-sub">{{ t('adv_logoutSub') }}</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="logout">
            {{ t('account_logout') }}
          </button>
        </div>
      </div>
    </div>

    <div class="grp">
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="info" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('adv_version') }}</div>
          </div>
          <span class="sc-tail">v{{ version }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { state, toggleAutoSync, toggleErrorReport, logout, fmt } from '../store.js';
import { t } from '../lib/i18n.js';
import { appVersion } from '../lib/appVersion.js';
import SwitchToggle from './ui/SwitchToggle.vue';
import Icon from './ui/Icon.vue';

defineProps({ bare: { type: Boolean, default: false } });

const version = appVersion();
</script>
