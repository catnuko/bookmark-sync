<template>
  <!-- 主屏 -->
  <div v-if="!state.drawer" class="flex h-full flex-col">
    <PopupChrome>
      <span
        class="grid size-[18px] flex-none place-items-center rounded-xs bg-primary text-[9px] font-bold text-primary-foreground"
        aria-hidden="true"
        >B</span
      >
      <span class="text-caption font-semibold">Bookmark Sync</span>
    </PopupChrome>

    <div class="scroll-y flex flex-col gap-2 px-3 py-3">
      <StatusCard />

      <Alert
        v-if="syncState === 'never' && state.keyStateLoaded && !state.hasKeyNow"
        variant="info"
      >
        <Info :stroke-width="1.75" />
        <span>{{ t('popup_keyBanner') }}</span>
      </Alert>

      <QuotaCard />

      <Button id="syncNow" size="xl" :disabled="state.syncBusy" @click="syncNow()">
        <LoaderCircle v-if="state.syncBusy" class="animate-spin" :stroke-width="1.75" />
        <RefreshCw v-else-if="syncState === 'error'" :stroke-width="1.75" />
        <Plus v-else :stroke-width="1.75" />
        {{
          state.syncBusy
            ? t('popup_syncing')
            : syncState === 'error'
              ? t('popup_resync')
              : t('popup_syncNow')
        }}
      </Button>

      <ListGroup>
        <ListRow as="button" clickable data-test="open-account" @click="openDrawer('account')">
          <template #leading>
            <User :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('popup_accountRow') }}</div>
          <template #tail>
            <span class="text-body-sm text-(--text-secondary-c)">{{ planLabel }}</span>
            <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
        <ListRow as="button" clickable @click="openDrawer('help')">
          <template #leading>
            <CircleHelp :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('common_help') }}</div>
          <template #tail>
            <span class="text-body-sm text-(--text-secondary-c)">{{ t('popup_helpTail') }}</span>
            <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
        <!-- 点击会打开商店网页（不是抽屉面板），故行尾用外链图标而非 chevron -->
        <ListRow
          as="button"
          clickable
          :title="t('common_opensInNewTab')"
          @click="openStoreReview()"
        >
          <template #leading>
            <Star :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('popup_rateRow') }}</div>
          <template #tail>
            <ExternalLink class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
        <ListRow as="button" clickable @click="openDrawer('feedback')">
          <template #leading>
            <Mail :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('feedback_title') }}</div>
          <template #tail>
            <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
        <ListRow as="button" clickable @click="openDrawer('system')">
          <template #leading>
            <Info :stroke-width="1.75" />
          </template>
          <div class="text-body font-medium">{{ t('sys_title') }}</div>
          <template #tail>
            <span class="text-body-sm text-(--text-secondary-c)">v{{ version }}</span>
            <ChevronRight class="size-4 text-quaternary" :stroke-width="1.75" />
          </template>
        </ListRow>
      </ListGroup>
    </div>
  </div>

  <!-- 二级面板（抽屉） -->
  <div v-else class="flex h-full flex-col">
    <PopupChrome drawer>
      <Button
        variant="ghost"
        size="icon-sm"
        data-test="drawer-back"
        :aria-label="t('common_back')"
        @click="closeDrawer"
      >
        <ChevronLeft :stroke-width="1.75" />
      </Button>
      <span class="text-body-sm font-semibold">{{ drawerTitle }}</span>
    </PopupChrome>
    <div class="scroll-y flex flex-col gap-3 px-3 py-3">
      <SpacesDrawer v-if="state.drawer === 'spaces'" />
      <KeyPanel v-else-if="state.drawer === 'key'" />
      <PaneAccount v-else-if="state.drawer === 'account'" bare />
      <PaneFeedback v-else-if="state.drawer === 'feedback'" bare />
      <PaneSystem v-else-if="state.drawer === 'system'" bare />
      <PaneHelp v-else bare />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Info,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Star,
  User,
} from '@lucide/vue';
import { state, openDrawer, closeDrawer, syncNow, syncState, planLabel } from '../store.js';
import { t } from '../lib/i18n.js';
import { openStoreReview } from '../lib/storeLink.js';
import { appVersion } from '../lib/appVersion.js';
import Alert from './ui/alert/Alert.vue';
import Button from './ui/button/Button.vue';
import ListGroup from './biz/ListGroup.vue';
import ListRow from './biz/ListRow.vue';
import PopupChrome from './biz/PopupChrome.vue';
import StatusCard from './biz/StatusCard.vue';
import QuotaCard from './biz/QuotaCard.vue';
import SpacesDrawer from './SpacesDrawer.vue';
import KeyPanel from './biz/KeyPanel.vue';
import PaneAccount from './PaneAccount.vue';
import PaneFeedback from './PaneFeedback.vue';
import PaneSystem from './PaneSystem.vue';
import PaneHelp from './PaneHelp.vue';

const drawerTitles = {
  spaces: () => t('spaces_title'),
  key: () => t('popup_keyRow'),
  help: () => t('common_help'),
  account: () => t('account_title'),
  feedback: () => t('feedback_title'),
  system: () => t('sys_title'),
};
const drawerTitle = computed(() => drawerTitles[state.drawer]?.() ?? '');

const version = appVersion();
</script>
