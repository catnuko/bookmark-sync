<template>
  <div
    ref="rootEl"
    class="flex w-full gap-0.5 rounded-full bg-muted p-0.5"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      :aria-checked="String(modelValue === opt.value)"
      :tabindex="modelValue === opt.value ? 0 : -1"
      :class="[
        'hit-slop-y relative h-8 flex-1 rounded-[calc(var(--radius)-4px)] text-body-sm font-medium transition-colors duration-160',
        modelValue === opt.value
          ? 'bg-background text-foreground shadow-raised'
          : 'text-(--text-on-inset) hover:text-foreground',
      ]"
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
import { ref } from 'vue';

// 分段控件（radiogroup 语义：登录/注册等二选一模式选择，非内容面板导航）。
// 保留 roving tabindex + 方向键；方向键聚焦走组件根内查询，不再依赖全局类名。
const props = defineProps({
  options: { type: Array, required: true }, // [{ value, label }]
  modelValue: { type: String, required: true },
  ariaLabel: { type: String, default: '' },
});
const emit = defineEmits(['update:modelValue']);

const rootEl = ref(null);

function onArrow(dir) {
  const btns = rootEl.value?.querySelectorAll('button');
  const len = btns?.length ?? 0;
  if (!len) return;
  const idx = props.options.findIndex((o) => o.value === props.modelValue);
  const next = (idx + dir + len) % len;
  btns[next]?.focus();
  emit('update:modelValue', props.options[next].value);
}
</script>
