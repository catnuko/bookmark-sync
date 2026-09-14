<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: "—" },
  hint: { type: String, default: "" },
});
</script>

<template>
  <div class="stat">
    <div class="label">{{ label }}</div>
    <div class="value">{{ value }}</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.stat {
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  box-shadow: var(--shadow-xs);
}
.label { font-size: 13px; color: var(--color-text-muted); }
.value { font-size: 26px; font-weight: 700; margin-top: 4px; color: var(--color-text); }
.hint { font-size: 12px; color: var(--color-text-faint); margin-top: 4px; }
</style>
