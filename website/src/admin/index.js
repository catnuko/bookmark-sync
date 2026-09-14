// 后台管理 — 路由表
// 主 router 直接挂载这段 children；/admin/login 与 /admin/forbidden 不走 AdminLayout。
import AdminLayout from "./components/AdminLayout.vue";
import { requireAdmin } from "./lib/auth.js";

export const adminRoutes = [
  {
    path: "/admin/login",
    name: "admin-login",
    component: () => import("./views/AdminLoginView.vue"),
    meta: { title: "Admin 登录", public: true },
  },
  {
    path: "/admin/forbidden",
    name: "admin-forbidden",
    component: () => import("./views/AdminForbiddenView.vue"),
    meta: { title: "无权访问", public: true },
  },
  {
    path: "/admin",
    component: AdminLayout,
    meta: { requiresAdmin: true },
    children: [
      { path: "", name: "admin-dashboard", component: () => import("./views/AdminDashboardView.vue"), meta: { title: "概览" } },
      { path: "users", name: "admin-users", component: () => import("./views/AdminUsersView.vue"), meta: { title: "用户" } },
      { path: "users/:id", name: "admin-user-detail", component: () => import("./views/AdminUserDetailView.vue"), meta: { title: "用户详情" } },
      { path: "orders", name: "admin-orders", component: () => import("./views/AdminOrdersView.vue"), meta: { title: "订单" } },
      { path: "subscriptions", name: "admin-subs", component: () => import("./views/AdminSubscriptionsView.vue"), meta: { title: "订阅" } },
      { path: "licenses", name: "admin-licenses", component: () => import("./views/AdminLicensesView.vue"), meta: { title: "卡密" } },
      { path: "system", name: "admin-system", component: () => import("./views/AdminSystemView.vue"), meta: { title: "系统" } },
    ],
  },
];

// 全局守卫：只拦截 requiresAdmin 路由
export function adminGuard(to) {
  if (to.matched.some((r) => r.meta?.requiresAdmin)) {
    return requireAdmin(to);
  }
  return true;
}
