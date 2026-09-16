<template>
  <div v-if="state.toasts.length" class="toast-host" role="status" aria-live="polite">
    <div
      v-for="t in state.toasts"
      :key="t.id"
      class="toast"
      :class="t.level"
    >
      <Icon :name="t.level === 'success' ? 'check-circle' : t.level === 'danger' ? 'alert' : 'info'" />
      <div>
        <b>{{ t.title }}</b>
        <i v-if="t.sub">{{ t.sub }}</i>
      </div>
    </div>
  </div>
</template>

<script setup>
import { state } from "../../store.js";
import Icon from "./Icon.vue";
</script>
