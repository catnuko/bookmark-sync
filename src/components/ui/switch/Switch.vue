<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { cn } from '../../../lib/utils';

const checked = defineModel<boolean>({ default: false });

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <!-- 现状无组件使用 switch（token 为预留）；接入时按 shadcn 默认样式（on 色 = primary，规范 §4.1） -->
  <SwitchRoot
    v-model:checked="checked"
    :class="
      cn(
        'relative flex h-[26px] w-11 flex-none cursor-pointer items-center rounded-full bg-muted px-0.5 transition-colors duration-160 data-[state=checked]:bg-primary',
        props.class,
      )
    "
  >
    <SwitchThumb
      class="size-[22px] rounded-full bg-white shadow-[0_1px_3px_rgba(10,10,10,0.25),0_0_1px_rgba(10,10,10,0.15)] transition-transform duration-160 data-[state=checked]:translate-x-[18px]"
    />
  </SwitchRoot>
</template>
