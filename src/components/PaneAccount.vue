<template>
  <section class="max-w-[620px]">
    <template v-if="!bare">
      <h2 class="text-[22px] font-semibold tracking-[-0.02em]">{{ t('account_title') }}</h2>
      <p class="mt-1 text-body-sm text-(--text-secondary-c)">{{ t('account_sub') }}</p>
    </template>

    <div class="mt-[22px]">
      <ListGroup>
        <ListRow class="min-h-16">
          <template #leading>
            <Avatar :label="userEmail" />
          </template>
          <div class="min-w-0 flex-1">
            <div class="text-body font-medium [overflow-wrap:anywhere]">{{ displayName }}</div>
            <div class="text-body-sm text-(--text-secondary-c) [overflow-wrap:anywhere]">
              {{ userEmail }}
            </div>
          </div>
          <Button variant="secondary" size="sm" data-test="logout" @click="logout">
            {{ t('account_logout') }}
          </Button>
        </ListRow>
        <ListRow>
          <template #leading>
            <CircleCheck :stroke-width="1.75" />
          </template>
          <div class="min-w-0 flex-1">
            <div class="text-body font-medium">{{ t('account_plan') }}</div>
            <div class="text-body-sm text-(--text-secondary-c)">{{ planFoot }}</div>
          </div>
          <template #tail>
            <Badge variant="secondary">{{ planLabel }}</Badge>
            <Button variant="ghost" size="sm" @click="openUpgrade">
              {{ t('common_upgrade') }}
            </Button>
          </template>
        </ListRow>
        <!-- 二级入口：只在 popup 抽屉里出现（bare）。设置页有自己的左侧导航，
             且 openDrawer 只驱动 popup 的抽屉，在那里点了不会有反应。 -->
        <ListRow
          v-if="bare"
          as="button"
          clickable
          data-test="open-spaces"
          @click="openDrawer('spaces')"
        >
          <template #leading>
            <Monitor :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('spaces_title') }}</div>
          <template #tail>
            <span class="text-body-sm text-(--text-secondary-c)">
              {{ t('popup_spacesDevices', state.spaces.length, state.devices.length) }}
            </span>
            <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
        <ListRow v-if="bare" as="button" clickable @click="openDrawer('key')">
          <template #leading>
            <Lock :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('popup_keyRow') }}</div>
          <template #tail>
            <Badge :variant="state.hasKeyNow ? 'success' : 'warning'">
              {{ state.hasKeyNow ? t('popup_keyReady') : t('popup_keyTodo') }}
            </Badge>
            <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
      </ListGroup>
      <p
        class="mt-2 ml-3.5 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)"
      >
        {{ t('account_foot') }}
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { ChevronRight, CircleCheck, Lock, Monitor } from '@lucide/vue';
import {
  state,
  userEmail,
  displayName,
  planLabel,
  logout,
  openUpgrade,
  openDrawer,
  quotaCount,
  usedCount,
} from '../store.js';
import { t } from '../lib/i18n.js';
import Avatar from './ui/avatar/Avatar.vue';
import Badge from './ui/badge/Badge.vue';
import Button from './ui/button/Button.vue';
import ListGroup from './biz/ListGroup.vue';
import ListRow from './biz/ListRow.vue';

defineProps({ bare: { type: Boolean, default: false } });

const planFoot = computed(() => {
  if (quotaCount.value == null) return t('account_planFootUnlimited');
  return t(
    'account_planFoot',
    quotaCount.value.toLocaleString(),
    (usedCount.value ?? 0).toLocaleString(),
  );
});
</script>
