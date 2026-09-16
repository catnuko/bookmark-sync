<template>
  <div class="card quota" :class="quotaState === 'over' ? 'over' : quotaState === 'warn' ? 'warn' : ''">
    <div class="q-head">
      <span class="badge" :class="quotaBadge.cls">{{ quotaBadge.text }}</span>
      <span class="spacer"></span>
      <button
        v-if="quotaBtn === 'upgrade'"
        class="btn btn-ghost btn-sm"
        :class="quotaState === 'over' ? 'btn-primary' : ''"
        @click="openUpgrade"
      >
        升级
      </button>
      <button v-else class="btn btn-ghost btn-sm" @click="manageSubscription">管理</button>
    </div>
    <div class="q-line">
      <template v-if="usedCount == null">
        <span class="q-total">额度加载中…</span>
      </template>
      <template v-else>
        <span class="q-used">{{ usedCount.toLocaleString() }}</span>
        <span class="q-total"> / {{ quotaCount ? quotaCount.toLocaleString() + ' 条' : '不限数量' }}</span>
      </template>
    </div>
    <div v-if="quotaCount" class="progress" :class="quotaState === 'over' ? 'over' : quotaState === 'warn' ? 'warn' : ''">
      <i :style="{ width: usagePct + '%' }"></i>
    </div>
    <div class="q-foot">
      <span class="dot" :class="quotaState === 'ok' ? 'dot-current' : ''"></span>
      {{ quotaFoot }}
    </div>
  </div>
</template>

<script setup>
import { usedCount, quotaCount, usagePct, quotaState, quotaBadge, quotaFoot, quotaBtn, openUpgrade, manageSubscription } from "../store.js";
</script>
