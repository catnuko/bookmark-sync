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

      <!--
        主题切换（跟随 / 浅色 / 深色）。只影响设置页 —— popup 入口不调 initTheme，
        见 lib/theme.ts 文件头。不用 v-model 而用显式 handler：v-model + watch
        会在挂载时把刚读出来的值再写回去一次（多余的 storage 写）。
      -->
      <div class="nav-foot">
        <div class="nav-foot-row">
          <span class="nav-foot-icon"><Icon name="moon" /></span>
          <span class="nav-foot-label">{{ t('theme_label') }}</span>
          <div class="nav-foot-seg">
            <SegTabs
              :model-value="theme"
              :options="themeOptions"
              :aria-label="t('theme_label')"
              @update:model-value="setTheme"
            />
          </div>
        </div>
      </div>
    </nav>
    <div class="opt-content">
      <!--
        这里只列 popup 里**没有**的功能。账户 / 空间 / 密钥 / 同步 / 帮助 / 反馈 / 系统
        全部由 popup 承载（账户与密钥是 popup 内的二级抽屉），在此重复一遍等于两处维护
        同一功能 —— 已于 2026-10-05 全部移除。加新 pane 前先确认 popup 真的放不下。

        六个 pane 的分工：
          ai       = AI 配置（一次性，宽表单）
          aiChat   = 书签问答（问答框在 400px 的 popup 里塞不下）
          organize = 整理书签（归类方案要逐组勾选 + diff 预览，popup 装不下）
          links    = 链接体检（批量探活要常驻页面跑，popup 一关就断）
          omnibox  = 地址栏搜索说明（原生 UI 无法嵌进 popup，这里只讲用法与排版规则）
          health   = 健康洞察（统计卡 + AI 总结 + 跳转建议）
      -->
      <PaneAI v-if="state.navPane === 'ai'" />
      <PaneAIChat v-else-if="state.navPane === 'aiChat'" />
      <PaneOrganize v-else-if="state.navPane === 'organize'" />
      <PaneLinkCheck v-else-if="state.navPane === 'links'" />
      <PaneOmnibox v-else-if="state.navPane === 'omnibox'" />
      <PaneHealth v-else-if="state.navPane === 'health'" />
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
import { onMounted, ref } from 'vue';
import { state } from '../store.js';
import { t } from '../lib/i18n.js';
import { readTheme, writeTheme } from '../lib/theme.js';
import PaneAI from './PaneAI.vue';
import PaneAIChat from './PaneAIChat.vue';
import PaneOrganize from './PaneOrganize.vue';
import PaneLinkCheck from './PaneLinkCheck.vue';
import PaneOmnibox from './PaneOmnibox.vue';
import PaneHealth from './PaneHealth.vue';
import Icon from './ui/Icon.vue';
import SegTabs from './ui/SegTabs.vue';

const panes = [
  { id: 'ai', label: () => t('ai_title'), icon: 'star' },
  { id: 'aiChat', label: () => t('qa_title'), icon: 'chat' },
  { id: 'organize', label: () => t('org_title'), icon: 'folder' },
  { id: 'links', label: () => t('lnk_title'), icon: 'globe' },
  { id: 'omnibox', label: () => t('omb_title'), icon: 'search' },
  { id: 'health', label: () => t('hlt_title'), icon: 'shield' },
];

// 主题分段：三态都用图标（与原型一致），label 退为 aria-label
const themeOptions = [
  { value: 'auto', label: t('theme_auto'), icon: 'monitor' },
  { value: 'light', label: t('theme_light'), icon: 'sun' },
  { value: 'dark', label: t('theme_dark'), icon: 'moon' },
];

const theme = ref('auto');

function setTheme(p) {
  theme.value = p;
  void writeTheme(p);
}

/** popup 传来的「本次想看哪一页」。见 PopupView.vue → openSettingsPage。 */
const PANE_KEY = 'options.pane';

function isPaneId(v) {
  return panes.some((p) => p.id === v);
}

// 挂载后校正到真实 pane。三条来源，优先级从低到高：
//   1. state.navPane —— 同页内切过 pane 时保留用户的选择
//   2. 非法值（历史默认 'account' 已不存在）→ 兜底到第一项，否则空白页
//   3. storage.session 里 popup 传来的目标 pane（跨页专用，用完即删）
onMounted(async () => {
  // 主题：读权威值回填分段控件。DOM 上的 data-theme 已由 main.ts 的 initTheme()
  // 在 createApp 之前设好，这里只同步控件的选中态。
  theme.value = await readTheme();

  if (isPaneId(state.navPane)) return;
  state.navPane = panes[0].id;
  try {
    const got = await chrome.storage?.session?.get(PANE_KEY);
    const want = got?.[PANE_KEY];
    if (isPaneId(want)) state.navPane = want;
    // 用完即删：不删的话，下次手动打开设置页也会落在这一页
    if (want !== undefined) await chrome.storage?.session?.remove(PANE_KEY);
  } catch {
    // session 不可用：用默认 pane，不影响打开
  }
});
</script>
