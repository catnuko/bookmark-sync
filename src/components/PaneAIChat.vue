<template>
  <section class="pane active">
    <h2>{{ t('qa_title') }}</h2>
    <p class="pane-sub">{{ t('qa_sub') }}</p>
    <div class="grp">
      <ChatPanel />
    </div>
  </section>
</template>

<script setup>
/**
 * PaneAIChat.vue — 设置页的「书签问答」pane。
 *
 * 只负责 pane 外壳（标题 + 副标题），交互全在 ui/ChatPanel.vue 里 —— 这样
 * ChatPanel 不依赖设置页的布局，将来想挪到 popup 抽屉里也能直接用。
 */
import { t } from '../lib/i18n.js';
import ChatPanel from './ui/ChatPanel.vue';
</script>
