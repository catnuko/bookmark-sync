<script setup>
import { computed, ref, onMounted } from 'vue';
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

/**
 * 页面切换动画**只在客户端启用**。
 *
 * ★ 为什么：<Transition> 在客户端首次渲染时会插入注释占位节点（Symbol(v-cmt)），
 *   而 SSG 产出的 HTML 里没有这个节点 → hydration node mismatch
 *   （实测报 "rendered on server: <node> / expected on client: Symbol(v-cmt)"）。
 *   首屏根本没有「切换」可动画，让它从 onMounted 之后再启用即可，
 *   用户感知不到差异，但 hydration 变干净。
 *
 * 反过来说：**新增任何依赖客户端状态才成立的 DOM，都要考虑 SSG 那一端渲染不出来**。
 */
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
</script>

<template>
  <div class="app-shell" :class="{ 'shell-admin': isAdmin }">
    <AppHeader v-if="!isAdmin" />
    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition v-if="mounted" name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
        <component v-else :is="Component" />
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
