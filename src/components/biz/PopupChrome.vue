<template>
  <div
    class="flex flex-none items-center border-b border-border bg-card"
    :class="drawer ? 'gap-1.5 py-1.5 pr-3 pl-2' : 'h-9 gap-2 px-3'"
  >
    <!-- 弹窗/抽屉顶部标题栏：leading 插槽放扩展图标（主屏）或返回按钮（抽屉） -->
    <slot />
    <span
      v-if="title"
      class="truncate font-semibold text-foreground"
      :class="drawer ? 'text-body' : 'text-caption'"
      >{{ title }}</span
    >
    <span class="ml-auto flex items-center gap-1.5" aria-hidden="true">
      <i v-for="i in 3" :key="i" class="block size-3 rounded-full bg-muted"></i>
    </span>
  </div>
</template>

<script setup>
// 旧 .popup-chrome / .drawer-chrome / .win-dots（规范 §4.1 PopupChrome）
defineProps({
  drawer: { type: Boolean, default: false },
  title: { type: String, default: '' },
});
</script>
