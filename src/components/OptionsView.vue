<template>
  <!--
    未登录 / 门禁态由 App.vue 统一处理（AuthView → PhraseGate → BindSpaceGate），
    走到这里必然已登录 —— 所以这里不再重复渲染登录视图。
  -->
  <div class="opt">
    <nav class="opt-nav" :aria-label="t('opts_navAria')">
      <!--
        品牌区与 popup 顶部标题栏共用同一组 class（.ext-ico / .ext-name），
        唯一差别是不带 .popup-chrome / .win-dots —— 那两个是弹窗标题栏的隐喻
        （浅底横条 + 三个假窗口圆点），在整页设置页里没有意义。
        改品牌样式请改 tokens.css 里那两个类，别在这里另写尺寸，否则两边会漂移。
      -->
      <div class="nav-brand">
        <span class="ext-ico">B</span>
        <span class="ext-name">Bookmark Sync</span>
      </div>
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
      <!--
        这里只列 popup 里**没有**的功能。账户 / 空间 / 密钥 / 同步 / 帮助 / 反馈 / 系统
        全部由 popup 承载（账户与密钥是 popup 内的二级抽屉），在此重复一遍等于两处维护
        同一功能 —— 已于 2026-10-05 全部移除。加新 pane 前先确认 popup 真的放不下。

        当前两个 pane 是同一功能的两半：ai = 配置（一次性，宽表单），
        aiChat = 书签问答（问答框在 400px 的 popup 里塞不下）。
      -->
      <PaneAI v-if="state.navPane === 'ai'" />
      <PaneAIChat v-else-if="state.navPane === 'aiChat'" />
    </div>
  </div>
</template>

<script setup>
/**
 * OptionsView.vue — 设置页（宽屏补充区）。
 *
 * ★ 与 popup 的分工（维护时必须遵守）：
 *   popup   = 高频操作，窄屏一屏搞定；入口在工具栏图标。
 *   options = 低频配置 / 宽表单，popup 里塞不下的才放这儿。
 * 唯一真源仍在 Pane* 组件本身，这里只做「用宽屏壳渲染哪个 Pane」的选择。
 * 切勿把 popup 已有的 Pane 搬回来 —— 那会造成两处 UI 各自演化、互相漂移。
 */
import { onMounted } from 'vue';
import { state } from '../store.js';
import { t } from '../lib/i18n.js';
import PaneAI from './PaneAI.vue';
import PaneAIChat from './PaneAIChat.vue';
import Icon from './ui/Icon.vue';

const panes = [
  { id: 'ai', label: () => t('ai_title'), icon: 'star' },
  { id: 'aiChat', label: () => t('qa_title'), icon: 'chat' },
];

// state.navPane 的历史默认值是 'account'（那是 PaneAccount 还在设置页时的第一项）。
// 设置页已无该 pane，不兜底就会渲染成空白页 —— 挂载后校正到第一个真实 pane。
onMounted(() => {
  if (!panes.some((p) => p.id === state.navPane)) state.navPane = panes[0].id;
});
</script>
