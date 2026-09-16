<template>
  <div class="overlay" @click.self="state.showUpgradeModal = false">
    <div class="modal">
      <div class="m-ico info"><Icon name="shield" /></div>
      <div class="m-title">升级解锁更多书签</div>
      <p class="m-body">当前已用 {{ (usedCount ?? 0).toLocaleString() }} 条。升级后立即生效，按年计费，可随时取消。</p>

      <div class="m-stack">
        <div class="plan-card">
          <div class="pc-top">
            <span class="pc-name">Plus</span>
            <span class="pc-price">$20<small>/年</small></span>
          </div>
          <ul>
            <li><Icon name="check" />最多 10,000 条书签</li>
            <li><Icon name="check" />3 个同步空间</li>
            <li><Icon name="check" />设备数量不限</li>
          </ul>
          <button class="btn btn-secondary" style="width:100%;margin-top:12px" :disabled="state.checkoutBusy" @click="startCheckout('plus')">
            {{ state.checkoutBusy ? '跳转中…' : '订阅 Plus' }}
          </button>
        </div>

        <div class="plan-card reco">
          <div class="pc-top">
            <span class="pc-name">Pro</span>
            <span class="badge badge-success badge-sub">推荐</span>
            <span class="pc-price">$50<small>/年</small></span>
          </div>
          <ul>
            <li><Icon name="check" />书签数量无限</li>
            <li><Icon name="check" />10 个同步空间</li>
            <li><Icon name="check" />设备数量不限</li>
          </ul>
          <button class="btn btn-primary" style="width:100%;margin-top:12px" :disabled="state.checkoutBusy" @click="startCheckout('pro')">
            {{ state.checkoutBusy ? '跳转中…' : '订阅 Pro' }}
          </button>
        </div>
      </div>

      <div class="m-actions">
        <button class="btn btn-ghost" @click="state.showUpgradeModal = false">稍后再说</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { state, startCheckout, usedCount } from "../store.js";
import Icon from "./ui/Icon.vue";
</script>
