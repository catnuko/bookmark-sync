<template>
  <template v-if="!state.session">
    <!-- 设置页未登录：居中登录视图 -->
    <div class="opt">
      <div class="opt-content" style="display:flex;justify-content:center">
        <div style="width:360px;padding-top:48px">
          <AuthView />
        </div>
      </div>
    </div>
  </template>

  <template v-else>
    <div class="opt">
      <nav class="opt-nav" aria-label="设置分区">
        <div class="nav-title">Bookmark Sync</div>
        <button
          v-for="p in panes"
          :key="p.id"
          :class="{ active: state.navPane === p.id }"
          type="button"
          @click="state.navPane = p.id"
        >
          <Icon :name="p.icon" />
          {{ p.label }}
        </button>
      </nav>
      <div class="opt-content">
        <PaneAccount v-if="state.navPane === 'account'" />
        <PaneSync v-else-if="state.navPane === 'sync'" />
        <PaneSpaces v-else-if="state.navPane === 'spaces'" />
        <PaneCrypto v-else-if="state.navPane === 'crypto'" />
        <PaneAdvanced v-else-if="state.navPane === 'advanced'" />
        <PaneHelp v-else-if="state.navPane === 'help'" />
      </div>
    </div>
  </template>
</template>

<script setup>
import { state } from "../store.js";
import AuthView from "./AuthView.vue";
import PaneAccount from "./PaneAccount.vue";
import PaneSync from "./PaneSync.vue";
import PaneSpaces from "./PaneSpaces.vue";
import PaneCrypto from "./PaneCrypto.vue";
import PaneAdvanced from "./PaneAdvanced.vue";
import PaneHelp from "./PaneHelp.vue";
import Icon from "./ui/Icon.vue";

const panes = [
  { id: "account", label: "账户", icon: "user" },
  { id: "sync", label: "同步", icon: "sync" },
  { id: "spaces", label: "空间与设备", icon: "monitor" },
  { id: "crypto", label: "加密", icon: "shield" },
  { id: "advanced", label: "高级", icon: "gear" },
  { id: "help", label: "帮助", icon: "help" },
];
</script>
