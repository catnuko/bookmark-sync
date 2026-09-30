<script setup>
// 根组件：登录分发 + 弹窗/设置页布局 + 全局模态与 Toast 容器
// 业务逻辑集中在 src/store.js（弹窗与设置页共用同一套状态与动作）
import { onMounted } from 'vue';
import { state, init } from './store.js';
import { describeError } from './lib/errors.js';
import AuthView from './components/AuthView.vue';
import PopupView from './components/PopupView.vue';
import OptionsView from './components/OptionsView.vue';
import PhraseGate from './components/PhraseGate.vue';
import BindSpaceGate from './components/BindSpaceGate.vue';
import ModalUpgrade from './components/ModalUpgrade.vue';
import ToastHost from './components/ui/ToastHost.vue';

const props = defineProps({ popup: { type: Boolean, default: false } });

// init() 现在保证「本地优先 + 已知路径不抛错」，但它仍是异步的，而 onMounted 不会
// 接住返回的 promise —— 一旦有意外 reject，Chrome 扩展错误列表里只剩一个
// `[object Object]`（非 Error 抛出物会被 String()），排障等于没有线索。
// 这里兜底记一条可读日志；门禁该 fail closed 仍 fail closed，不在这里放行。
onMounted(() => {
  void init(props.popup).catch((e) => {
    console.warn('[app] init failed:', describeError(e));
  });
});
</script>

<template>
  <AuthView v-if="!state.session" />
  <!-- 门禁判定中：显示启动占位，保证「登录 → 门禁 → 主界面」顺序，不闪现主界面 -->
  <div v-else-if="!state.gateChecked" class="boot-splash">
    <span class="spinner" />
  </div>
  <!-- 口令门禁是硬门槛：未设置/未验证口令前不渲染任何主界面 -->
  <PhraseGate v-else-if="state.phraseGateVisible" />
  <!-- 首绑门禁同样是硬门槛（整页、不可关闭）：本机从未绑定空间且云端有多个空间时，
       先选定这台电脑加入哪个，否则同步无处可落。 -->
  <BindSpaceGate v-else-if="state.bindGateVisible" />
  <PopupView v-else-if="props.popup" />
  <OptionsView v-else />

  <ModalUpgrade v-if="state.showUpgradeModal" />
  <ToastHost />
</template>

<style>
@import './styles/tokens.css';

/* popup 视口固定：宽高由令牌决定，内容溢出由 .popup-body 自己滚动（不再用 100vh 撑高窗口） */
body.popup {
  width: var(--popup-width);
  height: var(--popup-height);
  overflow: hidden;
}
body.popup #app {
  height: 100%;
}

/* 门禁判定期间的启动占位（popup 与 options 共用） */
.boot-splash {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
}
</style>
