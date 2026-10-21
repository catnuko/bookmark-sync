// 后台管理 — RPC 封装
// 统一调 supabase.rpc('admin_*')，把 PostgREST 的 {data, error} 拍平成 throw-or-return，
// 业务页面只关心数据；登录失效（401 / forbidden）由 auth.js 统一处理。
import { supabase } from '../../lib/supabase.js';

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
    const msg = error.message || error.details || '请求失败';
    const e = new Error(msg);
    e.code = error.code;
    e.status = error.status;
    throw e;
  }
  return data;
}

// —— 类型安全的薄封装（页面直接调，不拼字符串） ——
export const adminApi = {
  whoami: () => callAdmin('admin_whoami'),
  overview: () => callAdmin('admin_overview'),
  listUsers: (params) =>
    callAdmin('admin_list_users', {
      p_search: params.search ?? null,
      p_plan: params.plan ?? null,
      p_sort: params.sort ?? 'recent',
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  getUser: (userId) => callAdmin('admin_get_user', { p_user: userId }),
  // 0052：非 free 计划必须给到期时间（手工授予，到期自动降 free）
  // 类型标注必须写在**参数上**：写在对象属性上方（main 分支 4766b28 的做法）
  // tsc 不采纳，仍从默认值 null 推断成 null | undefined，传 ISO 串的调用方报 TS2345。
  setUserPlan: (userId, plan, /** @type {string | null} */ expiresAt = null) =>
    callAdmin('admin_set_user_plan', {
      p_user: userId,
      p_plan: plan,
      p_expires_at: expiresAt,
    }),
  resetUsage: (userId) => callAdmin('admin_reset_usage', { p_user: userId }),
  resetUserData: (userId) => callAdmin('admin_reset_user_data', { p_user: userId }),
  listOrders: (params) =>
    callAdmin('admin_list_orders', {
      p_status: params.status ?? null,
      p_plan: params.plan ?? null,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  listSubscriptions: (status) =>
    callAdmin('admin_list_subscriptions', { p_status: status ?? null }),
  systemStats: () => callAdmin('admin_system_stats'),
  // —— GC 监控与维护（服务端托管 GC）——
  getGcStats: (userId) => callAdmin('admin_get_gc_stats', { p_user: userId }),
  setGcThreshold: (userId, threshold) =>
    callAdmin('admin_set_gc_threshold', { p_user: userId, p_threshold: threshold }),
  requestGc: (userId) => callAdmin('admin_request_gc', { p_user: userId }),
  // —— 审计（0026：后台写操作留痕，可查可追溯）——
  listAuditLogs: (params) =>
    callAdmin('admin_list_audit_log', {
      p_action: params.action ?? null,
      p_target: params.target ?? null,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  // —— 用户反馈与错误上报（0045：反馈表 + 补上 0042 的读取通道）——
  listFeedback: (params) =>
    callAdmin('admin_list_feedback', {
      p_status: params.status ?? null,
      p_kind: params.kind ?? null,
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  setFeedbackStatus: (id, status, note = '') =>
    callAdmin('admin_set_feedback_status', { p_id: id, p_status: status, p_note: note }),
  listErrorReports: (params) =>
    callAdmin('admin_list_error_reports', {
      p_phase: params.phase ?? null,
      p_app_version: params.appVersion ?? null,
      p_group: params.group ?? 'row',
      p_limit: params.limit ?? 50,
      p_offset: params.offset ?? 0,
    }),
  getErrorReport: (id) => callAdmin('admin_get_error_report', { p_id: id }),
};
