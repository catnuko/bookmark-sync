<template>
  <section class="pane active">
    <h2 v-if="!bare">{{ t('sys_title') }}</h2>

    <div class="grp">
      <div class="inset-group">
        <div class="inset-row">
          <span class="lede"><Icon name="info" /></span>
          <div class="r-main">
            <div class="r-title">{{ t('sys_version') }}</div>
          </div>
          <span class="sc-tail">v{{ version }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
// 「系统」面板：目前只有版本号（原「高级」面板的版本行搬过来）。
import { t } from '../lib/i18n.js';
import { appVersion } from '../lib/appVersion.js';
import Icon from './ui/Icon.vue';

defineProps({ bare: { type: Boolean, default: false } });

const version = appVersion();
</script>
