<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSEO } from './seo/useSEO';
import AppHeader from './components/AppHeader.vue';
import AppFooter from './components/AppFooter.vue';

// 全局 SEO：根据当前路由动态设置 title / description / og / canonical / JSON-LD
// 路由变化、语言切换都会自动响应
useSEO();

// 后台页（/admin/**，路由 meta.admin）全屏独立，不套官网页头/页脚
const route = useRoute();
const isAdmin = computed(() => route.meta.admin === true);
</script>

<template>
  <div class="app-shell" :class="{ 'shell-admin': isAdmin }">
    <AppHeader v-if="!isAdmin" />
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <AppFooter v-if="!isAdmin" />
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

/* 后台无固定页头，不需要预留页头高度 */
.shell-admin .app-main {
  padding-top: 0;
}
</style>
