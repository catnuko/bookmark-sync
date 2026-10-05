<template>
  <template v-if="!state.session">
    <!-- 设置页未登录：居中登录视图 -->
    <div class="opt">
      <div class="opt-content" style="display: flex; justify-content: center">
        <div style="width: 360px; padding-top: 48px">
          <AuthView />
        </div>
      </div>
    </div>
  </template>

  <template v-else>
    <div class="opt">
      <nav class="opt-nav" :aria-label="t('opts_navAria')">
        <div class="nav-title">Bookmark Sync</div>
        <button
          v-for="p in panes"
          :key="p.id"
          :class="{ active: state.navPane === p.id }"
          type="button"
          @click="state.navPane = p.id"
        >
          <Icon :name="p.icon" />
          {{ p.label() }}
        </button>
      </nav>
      <div class="opt-content">
        <PaneAccount v-if="state.navPane === 'account'" />
        <PaneSync v-else-if="state.navPane === 'sync'" />
        <PaneSpaces v-else-if="state.navPane === 'spaces'" />
        <PaneCrypto v-else-if="state.navPane === 'crypto'" />
        <PaneAI v-else-if="state.navPane === 'ai'" />
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
import AuthView from './AuthView.vue';
import PaneAccount from './PaneAccount.vue';
import PaneSync from './PaneSync.vue';
import PaneSpaces from './PaneSpaces.vue';
import PaneCrypto from './PaneCrypto.vue';
import PaneAI from './PaneAI.vue';
import PaneHelp from './PaneHelp.vue';
import PaneFeedback from './PaneFeedback.vue';
import PaneSystem from './PaneSystem.vue';
import Icon from './ui/Icon.vue';

const panes = [
  { id: 'account', label: () => t('account_title'), icon: 'user' },
  { id: 'sync', label: () => t('sync_title'), icon: 'sync' },
  { id: 'spaces', label: () => t('spaces_title'), icon: 'monitor' },
  { id: 'crypto', label: () => t('crypto_title'), icon: 'shield' },
  { id: 'ai', label: () => t('ai_title'), icon: 'star' },
  { id: 'help', label: () => t('common_help'), icon: 'help' },
  { id: 'feedback', label: () => t('feedback_title'), icon: 'mail' },
  { id: 'system', label: () => t('sys_title'), icon: 'info' },
];
</script>
