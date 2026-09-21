<script setup>
defineProps({
  label: { type: String, required: true },
  tone: { type: String, default: 'neutral' }, // neutral/info/success/warning/danger
});
</script>

<template>
  <span class="badge" :class="`t-${tone}`">{{ label }}</span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
}
.t-neutral {
  background: #f4f4f5;
  color: #52525b;
}
.t-info {
  background: #eff6ff;
  color: #1d4ed8;
}
.t-success {
  background: #ecfdf5;
  color: #047857;
}
.t-warning {
  background: #fffbeb;
  color: #b45309;
}
.t-danger {
  background: #fef2f2;
  color: #b91c1c;
}
</style>
