<script setup lang="ts">
import {
  AccordionRoot,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
} from 'reka-ui';
import { ChevronRight } from '@lucide/vue';

defineProps<{ items: { title: string; body: string }[] }>();
</script>

<template>
  <AccordionRoot type="single" collapsible class="overflow-hidden rounded-lg bg-card">
    <AccordionItem
      v-for="(item, i) in items"
      :key="i"
      :value="`item-${i}`"
      class="border-t border-(--border-subtle) first:border-t-0"
    >
      <AccordionHeader as-child>
        <AccordionTrigger
          class="group flex w-full items-center gap-2.5 px-3 py-2.5 text-left min-h-12 text-body font-medium"
        >
          <span class="flex-1">{{ item.title }}</span>
          <ChevronRight
            :size="16"
            :stroke-width="1.75"
            class="size-4 text-quaternary transition-transform duration-240 ease-ios-inout group-data-[state=open]:rotate-90"
          />
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionContent
        class="overflow-hidden text-body-sm leading-(--text-body-sm--line-height) text-(--text-secondary-c) data-[state=closed]:hidden"
      >
        <div
          class="px-3 pb-3.5 [&_p+p]:mt-2 [&_strong]:font-semibold [&_strong]:text-foreground"
          v-html="item.body"
        />
      </AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>
