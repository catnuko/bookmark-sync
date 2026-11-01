<template>
  <component
    :is="as"
    :type="as === 'button' ? 'button' : undefined"
    :class="
      cn(
        'relative flex w-full items-center gap-3 px-3.5 py-2.5 text-left min-h-11 [&_svg]:shrink-0',
        clickable && 'cursor-pointer transition-colors duration-100 hover:bg-accent',
        $props.class,
      )
    "
  >
    <span
      v-if="$slots.leading"
      class="grid size-5 flex-none place-items-center text-(--text-secondary-c)"
    >
      <slot name="leading" />
    </span>
    <slot />
    <slot name="tail" />
  </component>
</template>

<script setup>
import { cn } from '../../lib/utils';

// 列表行（旧 .inset-row / .r-main）：leading 插槽放行首图标，默认插槽是标题/副行，
// tail 插槽放尾部徽标 / 按钮 / chevron。as="button" 用于可点行。
defineProps({
  as: { type: String, default: 'div' },
  clickable: { type: Boolean, default: false },
  class: { type: [String, Array, Object], default: '' },
});
</script>
