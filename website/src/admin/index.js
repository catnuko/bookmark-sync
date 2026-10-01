// 后台管理 — 路由表
// 主 router 直接挂载这段 children；/admin/login 与 /admin/forbidden 不走 AdminLayout。
// meta.admin 标记「后台页」，App.vue 据此隐藏官网页头/页脚（后台全屏独立，见 docs/admin/PROPOSAL.md §5）。
// 只需标三个顶层记录，子路由靠 vue-router 的 meta 合并继承。
import AdminLayout from './components/AdminLayout.vue';
import { requireAdmin } from './lib/auth.js';

export const adminRoutes = [
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('./views/AdminLoginView.vue'),
    meta: { title: 'Admin 登录', public: true, admin: true },
  },
  {
    path: '/admin/forbidden',
    name: 'admin-forbidden',
    component: () => import('./views/AdminForbiddenView.vue'),
    meta: { title: '无权访问', public: true, admin: true },
  },
  {
    path: '/admin',
    component: AdminLayout,
    meta: { requiresAdmin: true, admin: true },
    children: [
      {
        path: '',
        name: 'admin-dashboard',
        component: () => import('./views/AdminDashboardView.vue'),
        meta: { title: '概览' },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('./views/AdminUsersView.vue'),
        meta: { title: '用户' },
      },
      {
        path: 'users/:id',
        name: 'admin-user-detail',
        component: () => import('./views/AdminUserDetailView.vue'),
        meta: { title: '用户详情' },
      },
      {
        path: 'orders',
        name: 'admin-orders',
        component: () => import('./views/AdminOrdersView.vue'),
        meta: { title: '订单' },
      },
      {
        path: 'subscriptions',
        name: 'admin-subs',
        component: () => import('./views/AdminSubscriptionsView.vue'),
        meta: { title: '订阅' },
      },
      {
        path: 'audit',
        name: 'admin-audit',
        component: () => import('./views/AdminAuditView.vue'),
        meta: { title: '审计' },
      },
      {
        path: 'feedback',
        name: 'admin-feedback',
        component: () => import('./views/AdminFeedbackView.vue'),
        meta: { title: '反馈' },
      },
      {
        path: 'system',
        name: 'admin-system',
        component: () => import('./views/AdminSystemView.vue'),
        meta: { title: '系统' },
      },
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
