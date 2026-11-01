<script setup lang="ts">
import { ProgressRoot, ProgressIndicator } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '../../../lib/utils';

const props = defineProps<{
  modelValue?: number;
  class?: HTMLAttributes['class'];
}>();
</script>

<template>
  <ProgressRoot
    :model-value="props.modelValue"
    :class="cn('h-1.5 w-full overflow-hidden rounded-full bg-(--progress-track)', props.class)"
  >
    <ProgressIndicator
      class="h-full w-full flex-none rounded-full bg-primary transition-[width,background-color] duration-240 ease-decelerate"
      :style="{ transform: `translateX(-${100 - (props.modelValue ?? 0)}%)` }"
    />
  </ProgressRoot>
</template>
