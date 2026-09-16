<template>
  <div class="statuscard" :class="statusCls">
    <span class="sc-ic">
      <Icon v-if="syncState === 'ok'" name="check-circle" />
      <span v-else-if="syncState === 'syncing'" class="spinner" />
      <Icon v-else-if="syncState === 'error'" name="alert" />
      <Icon v-else name="cloud-slash" />
    </span>
    <div class="sc-main">
      <div class="sc-t">{{ syncTitle }}</div>
      <div class="sc-s">{{ syncSub }}</div>
    </div>
    <template v-if="syncState === 'error'">
      <button class="btn btn-ghost btn-sm retry" @click="syncNow()">重试</button>
    </template>
    <template v-else>
      <span class="sc-tail">{{ syncTail }}</span>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { state, syncNow, syncState, syncTitle, syncSub, syncTail } from "../store.js";
import Icon from "./ui/Icon.vue";

const statusCls = computed(() => {
  switch (syncState.value) {
    case "syncing": return "info";
    case "error": return "error";
    default: return "ok";
  }
});
</script>
