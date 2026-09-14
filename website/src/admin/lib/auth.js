// 后台管理 — 登录态与路由守卫
// 复用官网 Supabase 客户端（与扩展同账号体系）；管理员判定走 admin_whoami() RPC。
// 真正的权限在后端 RPC 里二次校验（assert_bsync_admin），这里只是 UX 层的早跳转。
import { reactive } from "vue";
import { supabase } from "../../lib/supabase.js";
import { adminApi } from "./client.js";

export const adminAuth = reactive({
  ready: false, // 初始 session + whoami 是否完成
  user: null,
  isAdmin: false,
  checkedAt: 0,
});

async function refresh() {
  const { data } = await supabase.auth.getSession();
  adminAuth.user = data.session?.user ?? null;
  adminAuth.isAdmin = false;
  if (adminAuth.user) {
    try {
      const me = await adminApi.whoami();
      adminAuth.isAdmin = !!me?.is_admin;
    } catch (e) {
      // 后端迁移未部署 / 网络错误：按非管理员处理，页面会展示错误
      adminAuth.isAdmin = false;
    }
  }
  adminAuth.checkedAt = Date.now();
  adminAuth.ready = true;
}

supabase.auth.onAuthStateChange(async () => {
  await refresh();
});

// 启动时拉一次。导出 readyPromise，供 main.js 在 mount 前等待。
export const adminReady = refresh();

export async function adminSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) return { error };
  adminAuth.user = data.user;
  await refresh();
  if (!adminAuth.isAdmin) {
    return { error: new Error("该账号不是管理员") };
  }
  return { error: null };
}

export async function adminSignOut() {
  await supabase.auth.signOut();
  adminAuth.user = null;
  adminAuth.isAdmin = false;
}

/**
 * vue-router 全局守卫：要求已登录且是管理员。
 * 登录页本身公开。未登录 → /admin/login；非管理员 → /admin/forbidden。
 */
export function requireAdmin(to) {
  if (!adminAuth.ready) return true; // 等待首次 refresh（main.js 里 await）
  if (!adminAuth.user) {
    return { path: "/admin/login", query: to.fullPath !== "/admin" ? { redirect: to.fullPath } : {} };
  }
  if (!adminAuth.isAdmin) {
    return { path: "/admin/forbidden" };
  }
  return true;
}
