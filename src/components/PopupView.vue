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

      <div v-if="syncState === 'never' && state.keyStateLoaded && !state.hasKeyNow" class="banner banner-info">
        <Icon name="info" />
        <span>首次同步前请确认同步密钥。端到端加密强制开启，密钥丢失即数据不可恢复。</span>
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
        {{ state.syncBusy ? '正在同步…' : syncState === 'error' ? '重新同步' : '立即同步' }}
      </button>

      <div class="inset-group">
        <button type="button" class="inset-row clickable" @click="openDrawer('spaces')">
          <span class="lede"><Icon name="monitor" /></span>
          <span class="r-main"><span class="r-title">空间与设备</span></span>
          <span class="sc-tail">{{ state.spaces.length }} 个空间 · {{ state.devices.length }} 台设备</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('key')">
          <span class="lede"><Icon name="lock" /></span>
          <span class="r-main"><span class="r-title">同步密钥</span></span>
          <span class="badge" :class="state.hasKeyNow ? 'badge-success' : 'badge-warning'">{{ state.hasKeyNow ? '已就绪' : '待设置' }}</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('advanced')">
          <span class="lede"><Icon name="gear" /></span>
          <span class="r-main"><span class="r-title">高级</span></span>
          <span class="sc-tail">共存策略 · GC · 自动同步</span>
          <Icon class="chev" name="chevron-right" />
        </button>
        <button type="button" class="inset-row clickable" @click="openDrawer('help')">
          <span class="lede"><Icon name="help" /></span>
          <span class="r-main"><span class="r-title">帮助</span></span>
          <span class="sc-tail">常见问题与说明</span>
          <Icon class="chev" name="chevron-right" />
        </button>
      </div>
    </div>
  </div>

  <!-- 二级面板（抽屉） -->
  <div v-else class="popup-root">
    <div class="drawer-chrome">
      <button class="icon-btn" aria-label="返回" @click="closeDrawer">
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
import { computed } from "vue";
import { state, openDrawer, closeDrawer, syncNow, syncState } from "../store.js";
import StatusCard from "./StatusCard.vue";
import QuotaCard from "./QuotaCard.vue";
import SpacesDrawer from "./SpacesDrawer.vue";
import KeyPanel from "./KeyPanel.vue";
import PaneAdvanced from "./PaneAdvanced.vue";
import PaneHelp from "./PaneHelp.vue";
import Icon from "./ui/Icon.vue";

const drawerTitles = { spaces: "空间与设备", key: "同步密钥", advanced: "高级", help: "帮助" };
const drawerTitle = computed(() => drawerTitles[state.drawer] ?? "");
</script>
