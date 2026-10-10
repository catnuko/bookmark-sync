// 账号与订阅状态 —— 官网侧的登录 / 订阅 / 取消订阅入口
//
// 登录：邮箱 + 密码，与扩展端同一套 Supabase Auth（同账号两端通用）。
// 订阅：调 creem-checkout 边缘函数拿收银台链接，支付结果由 creem-webhook 翻转服务端 plan。
// 取消：调 creem-portal 拿 Creem 客户门户链接，门户内 Cancel，webhook 同步状态。
// 状态：RLS 只读自己的 bsync_profiles.plan 与 bsync_subscriptions。
//
// ★ 迁移到 Next 后：本文件去掉了 Vue 的 reactive，改为「普通对象 + 版本号 + 订阅」，
//   React 侧通过 useAccount()（useSyncExternalStore）订阅。对外 API（account 字段与
//   各导出函数）保持不变，根仓库的 tests/website/accountState.test.ts 无需改动。
import { supabase } from './supabase.js';

/**
 * @typedef {{ plan: string|null, status: string, current_period_end?: string|null }} AccountSubscription
 * @type {{ ready: boolean, user: { id: string, email?: string }|null, plan: string|null, subscription: AccountSubscription|null, error: string|null }}
 */
export const account = {
  ready: false,
  user: null,
  plan: 'free', // bsync_profiles.plan：free / plus / pro；null = 拉取失败（≠ free）
  subscription: null, // bsync_subscriptions 行或 null：{ plan, status, current_period_end }
  // 拉 profile 失败时的原因（null = 正常）。付费用户拿不到 plan 时会被误判成
  // free 而再买一次，所以必须能把「读失败」和「真的是 free」区分开。
  error: null,
};

// —— React 订阅通道（useSyncExternalStore 用）——
let version = 0;
const listeners = new Set();
export function getAccountVersion() {
  return version;
}
export function subscribeAccount(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  version += 1;
  for (const fn of listeners) fn();
}

async function refreshProfile() {
  if (!account.user) {
    account.plan = 'free';
    account.subscription = null;
    account.error = null;
    notify();
    return;
  }
  const [prof, sub] = await Promise.all([
    supabase.from('bsync_profiles').select('plan').maybeSingle(),
    supabase.from('bsync_subscriptions').select('plan, status, current_period_end').maybeSingle(),
  ]);
  // ★ 两个查询都必须无错才算读成功。RLS 拒绝 / 网络失败 / 无表权限时 data 为
  //   null 且 error 有值——此时若照旧把 plan 落成 'free'，付费用户会在页面上
  //   看到「订阅 Pro」按钮，再付一次钱。宁可显示「状态未知」也别误导。
  const failed = prof.error || sub.error;
  if (failed) {
    account.error = failed.message || '读取账户状态失败';
    account.plan = null; // null ≠ 'free'：UI 必须显式区分「未知」和「免费」
    account.subscription = null;
    console.warn('[account] refreshProfile failed:', account.error);
    notify();
    return;
  }
  account.error = null;
  account.plan = prof.data?.plan || 'free';
  account.subscription = sub.data || null;
  notify();
}

// ★ 服务端（预渲染）下短路：账号态是纯客户端状态，Node 端拉 session 会
//   拖挂预渲染进程。SSG 产物一律按「未登录」渲染，客户端 hydrate 后再补真实态。
if (typeof window !== 'undefined') {
  supabase.auth
    .getSession()
    .then(({ data }) => {
      account.user = data.session?.user ?? null;
      return refreshProfile();
    })
    .finally(() => {
      account.ready = true;
      notify();
    });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    account.user = session?.user ?? null;
    await refreshProfile();
  });
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) {
    account.user = data.user;
    await refreshProfile();
  }
  return { error };
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  // 邮箱确认关闭时 signUp 直接返回 session；开启时需要用户先去邮箱验证
  if (!error && data.session) {
    account.user = data.user;
    await refreshProfile();
  }
  return { error, needsEmailConfirm: !error && !data.session };
}

export async function signOut() {
  await supabase.auth.signOut();
  account.user = null;
  // ★ 必须再刷一次 profile。只置 user=null 会让 account.plan / account.subscription
  //   停在上一个账号的值上——account 是模块级单例，登出后 hasActiveSubscription()
  //   仍返回 true，定价页会把「订阅 Plus」显示成「管理 / 取消订阅」。
  await refreshProfile();
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.message || data.error || '请求失败');
  return data;
}

// 发起订阅：返回 Creem 收银台 URL（新窗口打开）
export async function startCheckout(plan) {
  const data = await invoke('bsync-creem-checkout', { plan });
  return data.checkout_url;
}

// 管理/取消订阅：返回 Creem 客户门户 URL（门户内可 Cancel Subscription）
export async function openPortal() {
  const data = await invoke('bsync-creem-portal', {});
  return data.portal_url;
}

// 订阅是否有效（active / scheduled_cancel 在到期前仍算有效）
export function hasActiveSubscription() {
  const s = account.subscription;
  return !!s && ['active', 'scheduled_cancel', 'past_due'].includes(s.status);
}

// 仅供测试：登出后 plan/subscription 是否真的被复位、失败时是否落 null，
// 这两条都只能从外部观察 account 来断言。
export async function refreshProfileForTest() {
  await refreshProfile();
}
