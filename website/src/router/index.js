import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';
import { adminRoutes, adminGuard } from '../admin/index.js';
import { buildRoutes, localeFromPath } from './routes';
import { CONTENT_ROUTES } from '../content/manifest';

const isServer = typeof window === 'undefined';

/**
 * 建 router 实例。
 *
 * 两个必须遵守的约束（改之前先想清楚）：
 *   1. **每页独立实例**。vue-router 的 currentRoute 是实例级可变状态，
 *      SSG 预渲染十几个页面复用同一个 router 会串页。
 *   2. **服务端用 memory history**。createWebHistory 内部读 window/document，
 *      在 Node 里直接抛 `window is not defined`。
 *
 * @param {boolean} withAdmin 是否挂载 /admin/**（SSG 传 false）
 */
export function createAppRouter(withAdmin = true) {
  const router = createRouter({
    history: isServer ? createMemoryHistory() : createWebHistory(),
    // 内容路由来自 src/content/manifest.js（构建期生成，两端共用同一份）
    routes: buildRoutes(withAdmin ? adminRoutes : [], CONTENT_ROUTES),
    scrollBehavior(to, from, savedPosition) {
      if (savedPosition) return savedPosition;
      if (to.hash) return { el: to.hash, behavior: 'smooth' };
      return { top: 0 };
    },
  });

  // 语言跟随 URL 前缀。URL 无语言前缀的中文页，若用户此前切过语言则沿用记忆
  // （纯视觉偏好；canonical 与 SEO 文案一律看 URL，不看这里）。
  router.beforeEach((to) => {
    if (withAdmin && to.matched.some((r) => r.meta?.requiresAdmin)) {
      return adminGuard(to);
    }
    return true;
  });

  return router;
}

/**
 * CSR 用的单例。**惰性**——SSG 通过 ssrLoadModule 加载本文件时不该顺手建一个
 * 挂在模块作用域的 router（会引入模块级副作用，也会拖进 admin 依赖）。
 */
let clientRouter = null;
export function getRouter() {
  if (!clientRouter) clientRouter = createAppRouter(true);
  return clientRouter;
}

export { localeFromPath };