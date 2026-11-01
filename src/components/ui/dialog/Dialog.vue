<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '../../../lib/utils';

const open = defineModel<boolean>('open', { default: false });

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-(--z-modal) bg-overlay p-4 [backdrop-filter:var(--material-blur-sm)]"
      />
      <DialogContent
        :class="
          cn(
            'modal-glass fixed top-1/2 left-1/2 z-(--z-modal) w-(--modal-width) -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 [backdrop-filter:var(--material-blur)] shadow-modal',
            props.class,
          )
        "
      >
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
