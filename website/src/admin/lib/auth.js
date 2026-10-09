// 后台管理 — 登录态（迁移前 src/admin/lib/auth.js 的 Vue-free 移植）
// 复用官网 Supabase 客户端（与扩展同账号体系）；管理员判定走 admin_whoami() RPC。
// 真正的权限在后端 RPC 里二次校验（assert_bsync_admin），这里只是 UX 层的早跳转。
//
// ★ 迁移到 Next：去掉 Vue reactive，改为「普通对象 + 版本号 + 订阅」，
//   React 侧通过 useAdminAuth() 订阅。路由守卫从 vue-router 守卫改为 <AdminGuard> 组件。
import { supabase } from '../../lib/supabase.js';
import { adminApi } from './client.js';

/** @type {{ ready: boolean, user: { id: string, email?: string }|null, isAdmin: boolean, checkedAt: number }} */
export const adminAuth = {
  ready: false, // 初始 session + whoami 是否完成
  user: null,
  isAdmin: false,
  checkedAt: 0,
};

// —— React 订阅通道 ——
let version = 0;
const listeners = new Set();
export function getAdminAuthVersion() {
  return version;
}
export function subscribeAdminAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  version += 1;
  for (const fn of listeners) fn();
}

async function refresh() {
  const { data } = await supabase.auth.getSession();
  adminAuth.user = data.session?.user ?? null;
  adminAuth.isAdmin = false;
  if (adminAuth.user) {
    try {
      const me = await adminApi.whoami();
      adminAuth.isAdmin = !!me?.is_admin;
    } catch {
      // 后端迁移未部署 / 网络错误：按非管理员处理，页面会展示错误
      adminAuth.isAdmin = false;
    }
  }
  adminAuth.checkedAt = Date.now();
  adminAuth.ready = true;
  notify();
}

const isServer = typeof window === 'undefined';

let started = false;
/** 浏览器侧启动一次鉴权刷新（幂等）。由客户端组件在 useEffect 里调用。 */
export function startAdminAuth() {
  if (isServer || started) return;
  started = true;
  supabase.auth.onAuthStateChange(async () => {
    await refresh();
  });
  refresh();
}

/** 同步读本机是否有 session（不发网络）。读不到就是没登录过。 */
export function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // supabase-js v2 的 key 形如 `sb-<project-ref>-auth-token`
      if (k && k.endsWith('-auth-token')) {
        const v = localStorage.getItem(k);
        return !!v && v !== 'null';
      }
    }
  } catch {
    /* 隐私模式 / storage 被禁用：按无 session 处理，走登录页 */
  }
  return false;
}

/**
 * 快速路径：本机无 session 时同步判定为未登录（不必等 getSession()）。
 * 有 session 时确保鉴权链跑完（带缓存，不重复发 RPC），带 3s 兜底超时。
 * @returns {Promise<void>}
 */
let readyOnce = null;
export function ensureAdminAuth() {
  if (adminAuth.ready) return Promise.resolve();
  if (!hasStoredSession()) {
    // 本机没登录过：直接落定为未登录，避免一次不需要发生的等待。
    adminAuth.ready = true;
    adminAuth.user = null;
    adminAuth.isAdmin = false;
    notify();
    return Promise.resolve();
  }
  if (!readyOnce) {
    readyOnce = Promise.race([
      refresh(),
      new Promise((r) => setTimeout(r, 3000)),
    ]).then(() => undefined);
  }
  return readyOnce;
}

export async function adminSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error };
  adminAuth.user = data.user;
  await refresh();
  if (!adminAuth.isAdmin) {
    return { error: new Error('该账号不是管理员') };
  }
  return { error: null };
}

export async function adminSignOut() {
  await supabase.auth.signOut();
  adminAuth.user = null;
  adminAuth.isAdmin = false;
  notify();
}

/**
 * 按当前鉴权态给出去向。
 * @returns {string|null} 需要跳转的目标路径；null = 允许通过。
 */
export function decide(pathname) {
  if (!adminAuth.user) {
    // 登录后回到原目标（/admin 本身不记，避免无意义的 redirect 参数）
    if (pathname && pathname !== '/admin' && pathname !== '/admin/') {
      return `/admin/login?redirect=${encodeURIComponent(pathname)}`;
    }
    return '/admin/login';
  }
  if (!adminAuth.isAdmin) return '/admin/forbidden';
  return null;
}
