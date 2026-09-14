import { createRouter, createWebHistory } from "vue-router";
import { adminRoutes, adminGuard } from "../admin/index.js";

const routes = [
  {
    path: "/",
    name: "home",
    component: () => import("../views/HomeView.vue"),
    meta: { titleKey: "nav.home" },
  },
  {
    path: "/pricing",
    name: "pricing",
    component: () => import("../views/PricingView.vue"),
    meta: { titleKey: "nav.pricing" },
  },
  {
    path: "/download",
    name: "download",
    component: () => import("../views/DownloadView.vue"),
    meta: { titleKey: "nav.download" },
  },
  {
    path: "/docs",
    name: "docs",
    component: () => import("../views/DocsView.vue"),
    meta: { titleKey: "nav.docs" },
  },
  {
    path: "/privacy",
    name: "privacy",
    component: () => import("../views/PrivacyView.vue"),
    meta: { titleKey: "nav.privacy" },
  },
  {
    path: "/terms",
    name: "terms",
    component: () => import("../views/TermsView.vue"),
    meta: { titleKey: "nav.terms" },
  },
  // 后台管理（/admin/**，需在 catch-all 之前注册）
  ...adminRoutes,
  {
    // 兜底 404 → 回首页
    path: "/:pathMatch(.*)*",
    redirect: "/",
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return { el: to.hash, behavior: "smooth" };
    return { top: 0 };
  },
});

router.beforeEach(adminGuard);
