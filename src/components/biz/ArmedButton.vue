<template>
  <Button
    variant="outline-destructive"
    :class="
      armed
        ? 'animate-armed border-transparent bg-armed text-white hover:bg-armed-hover active:bg-armed-hover'
        : ''
    "
    :disabled="disabled"
    @click="$emit('press')"
  >
    <slot>{{
      armed ? (confirmLabel || label) + (countdown > 0 ? ' (' + countdown + ')' : '') : label
    }}</slot>
  </Button>
</template>

<script setup>
// 危险操作两步确认按钮：第一次点击进入 armed（显示倒计时），倒计时内再次点击触发
// confirm（由父组件通过 armed 状态 + @press 处理）。倒计时结束自动复位。
// armed 态从描边红变实底红脉冲（旧 .btn-armed）。
import Button from '../ui/button/Button.vue';

defineProps({
  label: { type: String, default: '' },
  confirmLabel: { type: String, default: '' }, // armed 时显示；为空则回退到 label + 倒计时
  armed: { type: Boolean, default: false },
  countdown: { type: Number, default: 0 }, // 0 = 不显示倒计时数字
  disabled: { type: Boolean, default: false },
});
defineEmits(['press']);
</script>
