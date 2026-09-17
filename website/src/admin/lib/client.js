// 后台管理 — RPC 封装
// 统一调 supabase.rpc('admin_*')，把 PostgREST 的 {data, error} 拍平成 throw-or-return，
// 业务页面只关心数据；登录失效（401 / forbidden）由 auth.js 统一处理。
import { supabase } from "../../lib/supabase.js";

/**
 * 调一个 admin RPC。
 * @param {string} fn 函数名（admin_ 前缀）
 * @param {object} args 入参
 * @returns {Promise<any>} 函数返回值
 * @throws {Error} 网络/权限/业务错误，message 已可直接展示
 */
export async function callAdmin(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // PostgREST 把 RAISE EXCEPTION 'forbidden ...' 的 message 放在 error.message
    const msg = error.message || error.details || "请求失败";
    const e = new Error(msg);
    e.code = error.code;
    e.status = error.status;
    throw e;
  }
  return data;
}

// —— 类型安全的薄封装（页面直接调，不拼字符串） ——
export const adminApi = {
  whoami: () => callAdmin("admin_whoami"),
  overview: () => callAdmin("admin_overview"),
  listUsers: (params) =>
    callAdmin("admin_list_users", {
      p_search: params.search ?? null,
      p_plan: params.plan ?? null,
      p_sort: params.sort ?? "recent",
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  getUser: (userId) => callAdmin("admin_get_user", { p_user: userId }),
  setUserPlan: (userId, plan) =>
    callAdmin("admin_set_user_plan", { p_user: userId, p_plan: plan }),
  resetUsage: (userId) => callAdmin("admin_reset_usage", { p_user: userId }),
  resetUserData: (userId) => callAdmin("admin_reset_user_data", { p_user: userId }),
  listOrders: (params) =>
    callAdmin("admin_list_orders", {
      p_status: params.status ?? null,
      p_plan: params.plan ?? null,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  listSubscriptions: (status) =>
    callAdmin("admin_list_subscriptions", { p_status: status ?? null }),
  systemStats: () => callAdmin("admin_system_stats"),
};
