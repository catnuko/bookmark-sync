<template>
  <section class="max-w-[620px]">
    <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t('spaces_title') }}</h2>
    <p class="mt-1 text-body-sm text-(--text-secondary-c)">{{ t('spaces_sub') }}</p>

    <div class="mt-[22px]">
      <SpacesList />
    </div>
    <div class="mt-[22px]">
      <DevicesList />
    </div>
  </section>
</template>

<script setup>
import { t } from '../lib/i18n.js';
import SpacesList from './biz/SpacesList.vue';
import DevicesList from './biz/DevicesList.vue';
</script>
