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
        <!--
          AI 功能入口（设置页）。设置页只承载 popup 塞不下的宽表单与对话区，
          所以必须从这里进去 —— 否则它就是个没人能找到的死页。

          行名叫**功能名**（整理书签）而不是「更多设置」：用户找的是功能，
          不是「设置」这个抽象概念。因此也不需要右侧的 tail —— 名字本身已经说清了，
          再加一句「AI 整理书签」就是重复。

          落点是设置页的默认 pane（AI 配置）：用户选的就是「先让配 Key」这条路径。
          点击会新开标签页（不是抽屉），故用外链图标而非 chevron。
        -->
        <button
          type="button"
          class="inset-row clickable"
          :title="t('common_opensInNewTab')"
          @click="openSettingsPage()"
        >
          <span class="lede"><Icon name="gear" /></span>
          <span class="r-main"
            ><span class="r-title">{{ t('popup_settingsRow') }}</span></span
          >
          <Icon class="ext" name="external-link" />
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

/**
 * 打开设置页（options.html）并直达「整理书签」pane。
 *
 * 用 openOptionsPage() 而不是 window.open('options.html')：前者由浏览器托管，
 * 会在正确的标签页里打开、遵守用户的扩展页设置；后者在 popup 里会被当作相对路径，
 * 且在 Firefox 上行为不一致。
 *
 * ★ 为什么用 storage.session 传 pane 而不用 hash：
 *   1. popup 与 options 是**两个独立的 JS 上下文**，`state.navPane` 不共享 ——
 *      直接写 store 只在本页有效，options 照样落到自己的默认值。
 *   2. session 而非 local：这是「本次跳转想看哪一页」的临时意图，不该留到下次
 *      启动（local 会漫游到别的设备，用户会莫名其妙落在整理书签页）。
 *      session 只活在当前浏览器会话内，且不进 sync。
 *   3. 读侧用完即删（见 OptionsView.vue），避免「下次手动打开设置页也落在
 *      整理书签」——那会让用户找不到 AI 配置入口。
 */
const PANE_KEY = 'options.pane';

function openSettingsPage() {
  void chrome.storage?.session
    ?.set({ [PANE_KEY]: 'organize' })
    .then(() => chrome.runtime.openOptionsPage())
    .catch(() => {
      // session 不可用（老 Firefox）时退化成默认 pane，不要因此打不开设置页
      chrome.runtime.openOptionsPage();
    });
}
</script>
