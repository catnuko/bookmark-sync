<template>
  <section class="pane active">
    <h2>同步</h2>
    <p class="pane-sub">控制自动同步行为。</p>

    <div class="grp">
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="sync" /></span>
          <div class="r-main">
            <div class="r-title">自动同步</div>
            <div class="r-sub">检测到本地书签变更后，自动在后台加密上传并拉取增量</div>
          </div>
          <SwitchToggle :model-value="state.autoSync" aria-label="自动同步" @update:model-value="toggleAutoSync" />
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="list" /></span>
          <div class="r-main">
            <div class="r-title">冲突处理</div>
            <div class="r-sub">Move-CRDT 并集合并，重复项自动去重</div>
          </div>
          <span class="badge badge-neutral badge-sub">内置</span>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="refresh" /></span>
          <div class="r-main">
            <div class="r-title">立即同步</div>
            <div class="r-sub">上次同步 {{ fmtRelative(state.lastSyncAt) }} · {{ (usedCount ?? 0).toLocaleString() }} 条</div>
          </div>
          <button class="btn btn-primary btn-sm" :disabled="state.syncBusy" @click="syncNow()">
            <span v-if="state.syncBusy" class="spinner" />
            {{ state.syncBusy ? '同步中' : '同步' }}
          </button>
        </div>
      </div>
      <p class="foot">同步在本地完成加解密，仅上传密文。断网后自动排队，恢复后补同步。</p>
    </div>
  </section>
</template>

<script setup>
import { state, syncNow, toggleAutoSync, fmtRelative, usedCount } from "../store.js";
import SwitchToggle from "./ui/SwitchToggle.vue";
import Icon from "./ui/Icon.vue";
</script>
