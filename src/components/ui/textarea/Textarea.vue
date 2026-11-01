<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { cn } from '../../../lib/utils';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();

const model = defineModel<string>({ default: '' });
</script>

<template>
  <textarea
    v-model="model"
    :class="
      cn(
        'min-h-24 w-full rounded-md border border-input bg-background px-3 py-2.5 text-body leading-(--text-body-sm--line-height) resize-y transition-[border-color] duration-160 placeholder:text-(--text-placeholder) hover:border-(--text-quaternary) focus:border-primary aria-invalid:border-destructive-text disabled:opacity-50',
        props.class,
      )
    "
  />
</template>
