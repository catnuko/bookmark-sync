<template>
  <!-- 主屏 -->
  <div v-if="!state.drawer" class="popup-root">
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
    </div>

    <div class="popup-foot">
      <button type="button" class="link-btn" @click="openHelp">帮助</button>
      <i class="fw-sep"></i>
      <button type="button" class="link-btn" @click="openSettings">设置</button>
    </div>
  </div>

  <!-- 二级面板（抽屉） -->
  <div v-else class="popup-root">
    <div class="drawer-chrome">
      <button class="icon-btn" aria-label="返回" @click="closeDrawer">
        <Icon name="chevron-left" />
      </button>
      <span class="ext-name">{{ state.drawer === 'spaces' ? '空间与设备' : '同步密钥' }}</span>
    </div>
    <div class="drawer-body">
      <SpacesDrawer v-if="state.drawer === 'spaces'" />
      <KeyPanel v-else />
    </div>
  </div>
</template>

<script setup>
import { state, openDrawer, closeDrawer, openHelp, openSettings, syncNow, syncState } from "../store.js";
import StatusCard from "./StatusCard.vue";
import QuotaCard from "./QuotaCard.vue";
import SpacesDrawer from "./SpacesDrawer.vue";
import KeyPanel from "./KeyPanel.vue";
import Icon from "./ui/Icon.vue";
</script>
