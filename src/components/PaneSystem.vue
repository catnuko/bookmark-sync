<template>
  <section class="max-w-[620px]">
    <h2 v-if="!bare" class="text-[22px] font-semibold tracking-[-0.02em]">
      {{ t('sys_title') }}
    </h2>

    <div class="mt-[22px]">
      <ListGroup>
        <ListRow>
          <template #leading>
            <Info :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('sys_version') }}</div>
          <template #tail>
            <span class="text-body-sm text-(--text-secondary-c)">v{{ version }}</span>
          </template>
        </ListRow>
      </ListGroup>
    </div>
  </section>
</template>

<script setup>
// 「系统」面板：目前只有版本号（原「高级」面板的版本行搬过来）。
import { Info } from '@lucide/vue';
import { t } from '../lib/i18n.js';
import { appVersion } from '../lib/appVersion.js';
import ListGroup from './biz/ListGroup.vue';
import ListRow from './biz/ListRow.vue';

defineProps({ bare: { type: Boolean, default: false } });

const version = appVersion();
</script>
