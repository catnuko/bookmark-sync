<template>
  <div ref="rootEl" class="seg" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      :class="{ 'seg-icon': !!opt.icon }"
      :aria-checked="String(modelValue === opt.value)"
      :aria-label="opt.icon ? opt.label : undefined"
      :tabindex="modelValue === opt.value ? 0 : -1"
      @click="$emit('update:modelValue', opt.value)"
      @keydown.left.prevent="onArrow(-1)"
      @keydown.right.prevent="onArrow(1)"
      @keydown.up.prevent="onArrow(-1)"
      @keydown.down.prevent="onArrow(1)"
    >
      <Icon v-if="opt.icon" :name="opt.icon" />
      <span :class="{ 'sr-only': opt.icon }">{{ opt.label }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import Icon from './Icon.vue';

// 分段控件（radiogroup 语义：二选一 / 三选一的模式选择，非内容面板导航）
const props = defineProps({
  // [{ value, label, icon? }] —— 带 icon 时按钮只显示图标，label 退为 aria-label
  options: { type: Array, required: true },
  modelValue: { type: String, required: true },
  ariaLabel: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const rootEl = ref(null);
const idx = computed(() => props.options.findIndex((o) => o.value === props.modelValue));

function onArrow(dir) {
  const len = props.options.length;
  if (!len) return;
  const next = (idx.value + dir + len) % len;
  // ★ 必须在本组件内部找按钮。设置页同时存在两组 .seg（导航底部主题 + 整理书签分段），
  // 用全局 document.querySelector 会聚焦到另一组上去。
  const el = rootEl.value?.querySelector(`button:nth-child(${next + 1})`);
  el?.focus();
  // 注意发的是选项的 value，不是下标 —— 下标对 String 型 modelValue 是错的。
  emit('update:modelValue', props.options[next].value);
}
</script>

<style scoped>
/* 仅图标按钮：居中、去内边距，图标 13px（与原型左导航底部的主题分段一致） */
.seg button.seg-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.seg button.seg-icon :deep(svg) {
  width: 13px;
  height: 13px;
}
/* 视觉隐藏但保留给读屏：图标按钮的可读名 */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
