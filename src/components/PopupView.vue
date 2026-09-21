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
        <button type="button" class="inset-row clickable" @click="openDrawer('spaces')">
          <span class="lede"><Icon name="monitor" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('spaces_title') }}</span></span
          >
          <span class="sc-tail">{{
            t('popup_spacesDevices', state.spaces.length, state.devices.length)
          }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('key')">
          <span class="lede"><Icon name="lock" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('popup_keyRow') }}</span></span
          >
          <span class="badge" :class="state.hasKeyNow ? 'badge-success' : 'badge-warning'">{{
            state.hasKeyNow ? t('popup_keyReady') : t('popup_keyTodo')
          }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('advanced')">
          <span class="lede"><Icon name="gear" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('adv_title') }}</span></span
          >
          <span class="sc-tail">{{ t('popup_advTail') }}</span>
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
      <PaneAdvanced v-else-if="state.drawer === 'advanced'" bare />
      <PaneHelp v-else bare />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { state, openDrawer, closeDrawer, syncNow, syncState } from '../store.js';
import { t } from '../lib/i18n.js';
import StatusCard from './StatusCard.vue';
import QuotaCard from './QuotaCard.vue';
import SpacesDrawer from './SpacesDrawer.vue';
import KeyPanel from './KeyPanel.vue';
import PaneAdvanced from './PaneAdvanced.vue';
import PaneHelp from './PaneHelp.vue';
import Icon from './ui/Icon.vue';

const drawerTitles = {
  spaces: () => t('spaces_title'),
  key: () => t('popup_keyRow'),
  advanced: () => t('adv_title'),
  help: () => t('common_help'),
};
const drawerTitle = computed(() => drawerTitles[state.drawer]?.() ?? '');
</script>
