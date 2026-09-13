// 账号与订阅状态 —— 官网侧的登录 / 订阅 / 取消订阅入口
//
// 登录：邮箱 + 密码，与扩展端同一套 Supabase Auth（同账号两端通用）。
// 订阅：调 creem-checkout 边缘函数拿收银台链接，支付结果由 creem-webhook 翻转服务端 plan。
// 取消：调 creem-portal 拿 Creem 客户门户链接，门户内 Cancel，webhook 同步状态。
// 状态：RLS 只读自己的 bsync_profiles.plan 与 bsync_subscriptions。
import { reactive } from "vue";
import { supabase } from "./supabase.js";

export const account = reactive({
  ready: false,
  user: null,
  plan: "free", // bsync_profiles.plan：free / plus / pro
  subscription: null, // bsync_subscriptions 行或 null：{ plan, status, current_period_end }
});

async function refreshProfile() {
  if (!account.user) {
    account.plan = "free";
    account.subscription = null;
    return;
  }
  const [prof, sub] = await Promise.all([
    supabase.from("bsync_profiles").select("plan").maybeSingle(),
    supabase
      .from("bsync_subscriptions")
      .select("plan, status, current_period_end")
      .maybeSingle(),
  ]);
  account.plan = prof.data?.plan || "free";
  account.subscription = sub.data || null;
}

supabase.auth.getSession().then(({ data }) => {
  account.user = data.session?.user ?? null;
  return refreshProfile();
}).finally(() => {
  account.ready = true;
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  account.user = session?.user ?? null;
  await refreshProfile();
});

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
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.message || data.error || "请求失败");
  return data;
}

// 发起订阅：返回 Creem 收银台 URL（新窗口打开）
export async function startCheckout(plan) {
  const data = await invoke("bsync-creem-checkout", { plan });
  return data.checkout_url;
}

// 管理/取消订阅：返回 Creem 客户门户 URL（门户内可 Cancel Subscription）
export async function openPortal() {
  const data = await invoke("bsync-creem-portal", {});
  return data.portal_url;
}

// 订阅是否有效（active / scheduled_cancel 在到期前仍算有效）
export function hasActiveSubscription() {
  const s = account.subscription;
  return !!s && ["active", "scheduled_cancel", "past_due"].includes(s.status);
}
