<template>
  <template v-if="!state.session">
    <!-- 设置页未登录：居中登录视图 -->
    <div class="flex min-h-screen justify-center bg-background">
      <div class="w-[360px] pt-12">
        <AuthView embedded />
      </div>
    </div>
  </template>

  <template v-else>
    <div class="flex min-h-screen bg-background">
      <nav
        class="w-[220px] flex-none border-r border-border px-3 py-4"
        :aria-label="t('opts_navAria')"
      >
        <div
          class="px-2.5 py-1.5 text-caption font-semibold tracking-[0.06em] text-tertiary uppercase"
        >
          Bookmark Sync
        </div>
        <button
          v-for="p in panes"
          :key="p.id"
          class="flex h-11 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-body-sm font-medium transition-colors duration-100 hover:bg-scrim [&_svg]:size-[17px]"
          :class="
            state.navPane === p.id
              ? 'bg-primary text-primary-foreground [&_svg]:text-primary-foreground'
              : '[&_svg]:text-(--text-secondary-c)'
          "
          type="button"
          @click="state.navPane = p.id"
        >
          <component :is="p.icon" :stroke-width="1.75" />
          {{ p.label() }}
        </button>
      </nav>
      <div class="min-w-0 flex-1 overflow-auto px-8 pt-6 pb-12">
        <PaneAccount v-if="state.navPane === 'account'" />
        <PaneSync v-else-if="state.navPane === 'sync'" />
        <PaneSpaces v-else-if="state.navPane === 'spaces'" />
        <PaneCrypto v-else-if="state.navPane === 'crypto'" />
        <PaneHelp v-else-if="state.navPane === 'help'" />
        <PaneFeedback v-else-if="state.navPane === 'feedback'" />
        <PaneSystem v-else-if="state.navPane === 'system'" />
      </div>
    </div>
  </template>
</template>

<script setup>
import { state } from '../store.js';
import { t } from '../lib/i18n.js';
import { CircleHelp, Info, Mail, Monitor, RefreshCw, ShieldCheck, User } from '@lucide/vue';
import AuthView from './AuthView.vue';
import PaneAccount from './PaneAccount.vue';
import PaneSync from './PaneSync.vue';
import PaneSpaces from './PaneSpaces.vue';
import PaneCrypto from './PaneCrypto.vue';
import PaneHelp from './PaneHelp.vue';
import PaneFeedback from './PaneFeedback.vue';
import PaneSystem from './PaneSystem.vue';

const panes = [
  { id: 'account', label: () => t('account_title'), icon: User },
  { id: 'sync', label: () => t('sync_title'), icon: RefreshCw },
  { id: 'spaces', label: () => t('spaces_title'), icon: Monitor },
  { id: 'crypto', label: () => t('crypto_title'), icon: ShieldCheck },
  { id: 'help', label: () => t('common_help'), icon: CircleHelp },
  { id: 'feedback', label: () => t('feedback_title'), icon: Mail },
  { id: 'system', label: () => t('sys_title'), icon: Info },
];
</script>
