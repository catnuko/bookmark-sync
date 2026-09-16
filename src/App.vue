<script setup>
// 根组件：登录分发 + 弹窗/设置页布局 + 全局模态与 Toast 容器
// 业务逻辑集中在 src/store.js（弹窗与设置页共用同一套状态与动作）
import { onMounted } from "vue";
import { state, init } from "./store.js";
import AuthView from "./components/AuthView.vue";
import PopupView from "./components/PopupView.vue";
import OptionsView from "./components/OptionsView.vue";
import ModalOnboard from "./components/ModalOnboard.vue";
import ModalFirstSync from "./components/ModalFirstSync.vue";
import ModalUpgrade from "./components/ModalUpgrade.vue";
import ToastHost from "./components/ui/ToastHost.vue";

const props = defineProps({ popup: { type: Boolean, default: false } });

onMounted(() => init(props.popup));
</script>

<template>
  <AuthView v-if="!state.session" />
  <PopupView v-else-if="props.popup" />
  <OptionsView v-else />

  <ModalOnboard v-if="state.showOnboard" />
  <ModalFirstSync v-if="state.showFirstSyncModal" />
  <ModalUpgrade v-if="state.showUpgradeModal" />
  <ToastHost />
</template>

<style>
@import "./styles/tokens.css";

/* popup 视口由扩展窗口宽度决定 */
body.popup { width: var(--popup-width); }
body.popup .popup-root { min-height: calc(100vh - var(--popup-padding-y) * 2); }
</style>
