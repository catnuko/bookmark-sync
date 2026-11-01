<template>
  <div
    class="mx-auto mb-3 grid size-10 place-items-center rounded-md"
    :class="{
      'bg-info-tint text-info-text': kind === 'info',
      'bg-warning-tint text-warning-text': kind === 'warning',
      'bg-destructive-tint text-destructive-text': kind === 'danger',
    }"
  >
    <slot />
  </div>
</template>

<script setup>
// 弹窗顶部 40px tint 色块图标（旧 .m-ico，规范 §4.1）
defineProps({ kind: { type: String, default: 'info' } });
</script>
