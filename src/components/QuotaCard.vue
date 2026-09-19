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
        {{ t("common_upgrade") }}
      </button>
      <button v-else class="btn btn-ghost btn-sm" @click="manageSubscription">{{ t("common_manage") }}</button>
    </div>
    <div class="q-line">
      <template v-if="usedCount == null">
        <span class="q-total">{{ t("quota_loading") }}</span>
      </template>
      <template v-else>
        <span class="q-used">{{ usedCount.toLocaleString() }}</span>
        <span class="q-total"> {{ quotaCount ? t("quota_countOf", quotaCount.toLocaleString()) : t("quota_unlimited") }}</span>
      </template>
    </div>
    <div v-if="usagePct > 0" class="progress" :class="quotaState === 'over' ? 'over' : quotaState === 'warn' ? 'warn' : ''">
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
import { t } from "../lib/i18n.js";
</script>
