<template>
  <section class="pane active">
    <h2>账户</h2>
    <p class="pane-sub">登录账号、方案与订阅。</p>

    <div class="grp">
      <div class="inset-group">
        <div class="inset-row" style="min-height:64px">
          <span class="avatar">{{ initial }}</span>
          <div class="r-main">
            <div class="r-title">{{ displayName }}</div>
            <div class="r-sub">{{ userEmail }}</div>
          </div>
          <button class="btn btn-secondary btn-sm" @click="logout">退出登录</button>
        </div>
        <div class="inset-row">
          <span class="lede"><Icon name="check-circle" /></span>
          <div class="r-main">
            <div class="r-title">当前方案</div>
            <div class="r-sub">{{ planFoot }}</div>
          </div>
          <span class="badge" :class="planBadgeCls">{{ planLabel }}</span>
          <button class="btn btn-ghost btn-sm" @click="openUpgrade">升级</button>
        </div>
      </div>
      <p class="foot">登录邮箱用于恢复会话与同步数据；密码不落盘。升级后立即生效，按年计费，可随时取消。</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { state, userEmail, displayName, planLabel, logout, openUpgrade, quotaCount, usedCount } from "../store.js";
import Icon from "./ui/Icon.vue";

const initial = computed(() => (userEmail.value ? userEmail.value[0].toUpperCase() : "?"));

const planBadgeCls = computed(() => {
  const p = state.profile?.plan;
  if (p === "pro" || p === "lifetime") return "badge-neutral";
  if (p === "plus" || p === "premium") return "badge-neutral";
  return "badge-neutral";
});

const planFoot = computed(() => {
  if (quotaCount.value == null) return "数量不限（约 25 万条封顶）· 10 个同步空间";
  const cap = quotaCount.value.toLocaleString();
  const used = usedCount.value ?? 0;
  return `最多 ${cap} 条书签 · 已用 ${used.toLocaleString()} 条`;
});
</script>
