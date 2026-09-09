<script setup>
import { useSEO } from "./seo/useSEO";
import AppHeader from "./components/AppHeader.vue";
import AppFooter from "./components/AppFooter.vue";

// 全局 SEO：根据当前路由动态设置 title / description / og / canonical / JSON-LD
// 路由变化、语言切换都会自动响应
useSEO();
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <AppFooter />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  padding-top: var(--header-height);
}
</style>
