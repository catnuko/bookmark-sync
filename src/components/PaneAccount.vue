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
        class="mt-2 ml-3 text-caption leading-(--text-caption--line-height) text-(--text-secondary-c)"
      >
        {{ t('account_foot') }}
      </p>
    </div>

    <!-- 危险操作区（ALNA-248）：注销账户 = 自助删除 auth.users 行，云端数据级联清理，
         本地书签不在删除路径上。删除前必须经过弹窗内的明确二次确认。 -->
    <div class="mt-6">
      <h3 class="text-body font-semibold text-destructive-text">{{ t('account_dangerTitle') }}</h3>
      <p class="mt-1 text-body-sm text-(--text-secondary-c)">{{ t('account_dangerSub') }}</p>
      <div class="mt-3 rounded-xl border border-destructive-border p-4">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="text-body font-medium">{{ t('delacct_rowTitle') }}</div>
            <div class="text-body-sm text-(--text-secondary-c)">{{ t('delacct_rowSub') }}</div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            class="flex-none"
            data-test="delete-account"
            @click="confirmOpen = true"
          >
            {{ t('delacct_open') }}
          </Button>
        </div>
      </div>
    </div>
    <ModalDeleteAccount v-model:open="confirmOpen" />
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
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
import ModalDeleteAccount from './ModalDeleteAccount.vue';

defineProps({ bare: { type: Boolean, default: false } });

const confirmOpen = ref(false);

const planFoot = computed(() => {
  if (quotaCount.value == null) return t('account_planFootUnlimited');
  return t(
    'account_planFoot',
    quotaCount.value.toLocaleString(),
    (usedCount.value ?? 0).toLocaleString(),
  );
});
</script>
