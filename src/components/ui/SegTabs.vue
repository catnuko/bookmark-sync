<template>
  <div class="seg" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      :aria-checked="String(modelValue === opt.value)"
      :tabindex="modelValue === opt.value ? 0 : -1"
      @click="$emit('update:modelValue', opt.value)"
      @keydown.left.prevent="onArrow(-1)"
      @keydown.right.prevent="onArrow(1)"
      @keydown.up.prevent="onArrow(-1)"
      @keydown.down.prevent="onArrow(1)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";

// 分段控件（radiogroup 语义：登录/注册等二选一模式选择，非内容面板导航）
const props = defineProps({
  options: { type: Array, required: true }, // [{ value, label }]
  modelValue: { type: String, required: true },
  ariaLabel: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const idx = computed(() => props.options.findIndex((o) => o.value === props.modelValue));

function onArrow(dir) {
  const len = props.options.length;
  if (!len) return;
  const next = (idx.value + dir + len) % len;
  const el = document.querySelector(`.seg button:nth-child(${next + 1})`);
  el?.focus();
  emit(next);
}
</script>
