'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ensureAdminAuth, startAdminAuth, decide } from './lib/auth.js';
import { useAdminAuth } from './lib/useAdminAuth';
import AdminShell from './components/AdminShell';
import AdminLoginView from './views/AdminLoginView';
import AdminForbiddenView from './views/AdminForbiddenView';
import AdminDashboardView from './views/AdminDashboardView';
import AdminUsersView from './views/AdminUsersView';
import AdminUserDetailView from './views/AdminUserDetailView';
import AdminOrdersView from './views/AdminOrdersView';
import AdminSubscriptionsView from './views/AdminSubscriptionsView';
import AdminAuditView from './views/AdminAuditView';
import AdminFeedbackView from './views/AdminFeedbackView';
import AdminSystemView from './views/AdminSystemView';
import styles from './AdminApp.module.css';

function renderView(p: string) {
  const rest = p.replace(/\/+$/, '').split('/').filter(Boolean).slice(1); // 去掉开头的 "admin"
  if (rest.length === 0) return <AdminDashboardView />;
  if (rest[0] === 'users') {
    if (rest.length === 1) return <AdminUsersView />;
    return <AdminUserDetailView userId={decodeURIComponent(rest[1])} />;
  }
  if (rest[0] === 'orders') return <AdminOrdersView />;
  if (rest[0] === 'subscriptions') return <AdminSubscriptionsView />;
  if (rest[0] === 'audit') return <AdminAuditView />;
  if (rest[0] === 'feedback') return <AdminFeedbackView />;
  if (rest[0] === 'system') return <AdminSystemView />;
  return <AdminDashboardView />;
}

export default function AdminApp() {
  const nextPath = usePathname();
  const auth = useAdminAuth();
  const [path, setPath] = useState<string | null>(null);
  const [guardReady, setGuardReady] = useState(false);

  useEffect(() => {
    startAdminAuth();
    setPath(window.location.pathname);
    ensureAdminAuth().finally(() => setGuardReady(true));
  }, []);

  useEffect(() => {
    setPath(window.location.pathname);
  }, [nextPath]);

  const isPublic = path === '/admin/login' || path === '/admin/forbidden';
  const ready = guardReady && auth.ready;
  const target = path && !isPublic && ready ? decide(path) : null;

  // 未登录 / 非管理员 → 跳转（放在 effect 里，避免渲染期副作用）
  useEffect(() => {
    if (target) window.location.replace(target);
  }, [target]);

  if (path === null) return null;
  if (path === '/admin/login') return <AdminLoginView />;
  if (path === '/admin/forbidden') return <AdminForbiddenView />;
  if (!ready || target) return <div className={styles.loading}>加载中…</div>;

  return <AdminShell current={path}>{renderView(path)}</AdminShell>;
}
