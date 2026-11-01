<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '../../../lib/utils';
import { type ButtonVariants, buttonVariants } from '.';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants['variant'];
    size?: ButtonVariants['size'];
    class?: HTMLAttributes['class'];
  }>(),
  { variant: undefined, size: undefined, class: undefined },
);
</script>

<template>
  <button type="button" :class="cn(buttonVariants({ variant, size }), props.class)">
    <slot />
  </button>
</template>
