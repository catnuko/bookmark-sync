'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { adminSignOut } from '../lib/auth.js';
import { useAdminAuth } from '../lib/useAdminAuth';
import styles from './AdminShell.module.css';

const NAV = [
  { to: '/admin/', label: '概览', icon: '📊' },
  { to: '/admin/users', label: '用户', icon: '👥' },
  { to: '/admin/orders', label: '订单', icon: '🧾' },
  { to: '/admin/subscriptions', label: '订阅', icon: '💳' },
  { to: '/admin/audit', label: '审计', icon: '📋' },
  { to: '/admin/feedback', label: '反馈', icon: '💬' },
  { to: '/admin/system', label: '系统', icon: '🖥️' },
];

const norm = (p: string) => (p !== '/' ? p.replace(/\/$/, '') : p);

export default function AdminShell({ current, children }: { current: string; children: ReactNode }) {
  const auth = useAdminAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 切页面后抽屉收起
  useEffect(() => {
    setDrawerOpen(false);
  }, [current]);

  // 抽屉打开时锁背景滚动（只在打开期间临时加，避免破坏桌面端侧栏 sticky）
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // 视口变宽（含横屏）回到桌面布局时收起抽屉，避免遮罩残留；Esc 关闭
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)');
    const onMqChange = (e: MediaQueryListEvent) => {
      if (e.matches) setDrawerOpen(false);
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    mq.addEventListener('change', onMqChange);
    window.addEventListener('keydown', onKeydown);
    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    };
  }, []);

  async function logout() {
    await adminSignOut();
    window.location.assign('/admin/login');
  }

  return (
    <div className={`${styles.adminShell} ${drawerOpen ? styles.drawerOpen : ''}`}>
      <aside id="admin-nav" className={styles.adminSide}>
        <div className={styles.brand}>BSYNC · Admin</div>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={`${styles.navItem} ${norm(current) === norm(item.to) ? styles.active : ''}`}
              onClick={() => setDrawerOpen(false)}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className={styles.sideFoot}>
          <a href="/" className={styles.backSite}>
            ← 返回官网
          </a>
        </div>
      </aside>

      {drawerOpen ? (
        <button
          className={styles.scrim}
          type="button"
          aria-label="关闭菜单"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <div className={styles.adminMain}>
        <header className={styles.adminTop}>
          <button
            className={styles.menuBtn}
            type="button"
            aria-label="打开菜单"
            aria-controls="admin-nav"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <div className={styles.who}>
            {auth.user ? <span className={styles.whoMail}>{auth.user.email}</span> : null}
            <button className={styles.btnGhost} type="button" onClick={logout}>
              退出
            </button>
          </div>
        </header>
        <main className={styles.adminContent}>{children}</main>
      </div>
    </div>
  );
}
