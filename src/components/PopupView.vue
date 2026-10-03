<template>
  <!-- 主屏 -->
  <div v-if="!state.drawer" class="popup-root">
    <div class="popup-chrome">
      <span class="ext-ico">B</span>
      <span class="ext-name">Bookmark Sync</span>
      <span class="win-dots"><i></i><i></i><i></i></span>
    </div>

    <div class="popup-body">
      <StatusCard />

      <div
        v-if="syncState === 'never' && state.keyStateLoaded && !state.hasKeyNow"
        class="banner banner-info"
      >
        <Icon name="info" />
        <span>{{ t('popup_keyBanner') }}</span>
      </div>

      <QuotaCard />

      <button
        id="syncNow"
        class="btn btn-primary btn-lg"
        :disabled="state.syncBusy"
        @click="syncNow()"
      >
        <span v-if="state.syncBusy" class="spinner" />
        <Icon v-else :name="syncState === 'error' ? 'refresh' : 'plus'" />
        {{
          state.syncBusy
            ? t('popup_syncing')
            : syncState === 'error'
              ? t('popup_resync')
              : t('popup_syncNow')
        }}
      </button>

      <div class="inset-group">
        <button type="button" class="inset-row clickable" @click="openDrawer('account')">
          <span class="lede"><Icon name="user" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('popup_accountRow') }}</span></span
          >
          <span class="sc-tail">{{ planLabel }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('help')">
          <span class="lede"><Icon name="help" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('common_help') }}</span></span
          >
          <span class="sc-tail">{{ t('popup_helpTail') }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <!-- 点击会打开商店网页（不是抽屉面板），故行尾用外链图标而非 chevron -->
        <button
          type="button"
          class="inset-row clickable"
          :title="t('common_opensInNewTab')"
          @click="openStoreReview()"
        >
          <span class="lede"><Icon name="star" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('popup_rateRow') }}</span></span
          >
          <Icon class="ext" name="external-link" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('feedback')">
          <span class="lede"><Icon name="mail" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('feedback_title') }}</span></span
          >
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('system')">
          <span class="lede"><Icon name="info" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('sys_title') }}</span></span
          >
          <span class="sc-tail">v{{ version }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
      </div>
    </div>
  </div>

  <!-- 二级面板（抽屉） -->
  <div v-else class="popup-root">
    <div class="drawer-chrome">
      <button class="icon-btn" :aria-label="t('common_back')" @click="closeDrawer">
        <Icon name="chevron-left" />
      </button>
      <span class="ext-name">{{ drawerTitle }}</span>
      <span class="win-dots"><i></i><i></i><i></i></span>
    </div>
    <div class="drawer-body">
      <SpacesDrawer v-if="state.drawer === 'spaces'" />
      <KeyPanel v-else-if="state.drawer === 'key'" />
      <PaneAccount v-else-if="state.drawer === 'account'" bare />
      <PaneFeedback v-else-if="state.drawer === 'feedback'" bare />
      <PaneSystem v-else-if="state.drawer === 'system'" bare />
      <PaneHelp v-else bare />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { state, openDrawer, closeDrawer, syncNow, syncState, planLabel } from '../store.js';
import { t } from '../lib/i18n.js';
import { openStoreReview } from '../lib/storeLink.js';
import { appVersion } from '../lib/appVersion.js';
import StatusCard from './StatusCard.vue';
import QuotaCard from './QuotaCard.vue';
import SpacesDrawer from './SpacesDrawer.vue';
import KeyPanel from './KeyPanel.vue';
import PaneAccount from './PaneAccount.vue';
import PaneFeedback from './PaneFeedback.vue';
import PaneSystem from './PaneSystem.vue';
import PaneHelp from './PaneHelp.vue';
import Icon from './ui/Icon.vue';

const drawerTitles = {
  spaces: () => t('spaces_title'),
  key: () => t('popup_keyRow'),
  help: () => t('common_help'),
  account: () => t('account_title'),
  feedback: () => t('feedback_title'),
  system: () => t('sys_title'),
};
const drawerTitle = computed(() => drawerTitles[state.drawer]?.() ?? '');

const version = appVersion();
</script>
