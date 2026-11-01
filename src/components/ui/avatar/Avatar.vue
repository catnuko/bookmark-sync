<script setup lang="ts">
import { computed } from 'vue';
import { AvatarRoot, AvatarFallback } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '../../../lib/utils';

const props = defineProps<{ label: string; class?: HTMLAttributes['class'] }>();

const initial = computed(() => (props.label ? props.label[0].toUpperCase() : '?'));
</script>

<template>
  <AvatarRoot
    :class="
      cn(
        'flex size-11 flex-none items-center justify-center rounded-full bg-primary font-bold text-title-lg text-primary-foreground select-none',
        props.class,
      )
    "
  >
    <AvatarFallback>{{ initial }}</AvatarFallback>
  </AvatarRoot>
</template>
