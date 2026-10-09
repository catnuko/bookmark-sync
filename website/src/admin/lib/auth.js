// 后台管理 — 登录态与路由守卫
// 复用官网 Supabase 客户端（与扩展同账号体系）；管理员判定走 admin_whoami() RPC。
// 真正的权限在后端 RPC 里二次校验（assert_bsync_admin），这里只是 UX 层的早跳转。
import { reactive } from 'vue';
import { supabase } from '../../lib/supabase.js';
import { adminApi } from './client.js';

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

// ★ 服务端（SSG 预渲染）下短路：模块级就会连 supabase，而在Node 里
//   supabase-js 依赖 localStorage / fetch，会把预渲染进程拖挂。
//   预渲染只产出官网页面，后台鉴权一律在客户端发生。
const isServer = typeof window === 'undefined';

/** 浏览器侧启动一次鉴权刷新；服务端返回永不 resolve 的占位 promise。 */
function startAuth() {
  if (isServer) return { ready: new Promise(() => {}) };
  supabase.auth.onAuthStateChange(async () => {
    await refresh();
  });
  return { ready: refresh() };
}

export const { ready: adminReady } = startAuth();

export async function adminSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
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
}

/**
 * vue-router 全局守卫：要求已登录且是管理员。
 * 登录页本身公开。未登录 → /admin/login；非管理员 → /admin/forbidden。
 *
 * ★ 2026-10-09：这里原本是 `if (!adminAuth.ready) return true;` ——注释写「等
 * main.js 里那次 await」。但守卫**不能假设调用方预等过**：main.js 里的预等已被
 * 移除（那个3 秒串行等待是 /admin 跳转慢的根因），若这里仍在 ready 之前放行，
 * 守卫就形同不存在——**任何人都能进后台视图**。
 *
 *   正确做法：**在这里真正等鉴权完成**。鉴权链只有「一次RPC」，很快；
 *   慢的是当初 bootstrap 里为它准备的 3 秒超时，而那个超时永远等不到
 *   （adminReady 在 refresh 完成后就 resolve，实测 ~200ms），只会把后续
 *   router.isReady() 一起堵住。
 *
 * ★ `readyOnce` 带缓存：首次之后直接返回同一个 promise，不重复发 RPC。
 * ★ 兜底超时仍然保留：网络不通 / 后端迁移未部署时挂住不能让路由永远 resolve
 *   （那是 2026-10-07「页面停在预渲染内容上」那个故障），超时后按未登录放行到登录页。
 */
// ★★ 快速路径（2026-10-09）：本机根本没有 session 时，**不要等 getSession()**。
//
//   实测踩坑过程：把预等删掉后 /admin 仍要 3.1s 才出登录页。探针显示
//   （包装 window.fetch）**整个过程零网络请求**，且 `setTimeout(3000)` 在 37ms
//   就排定 → 说明 vue-router 在等 `requireAdmin` 返回的 promise，而那个 promise
//   卡在 `supabase.auth.getSession()` 上**纯客户端空转**（本地 storage 里只有
//   `bsync.locale` 一个键，没有任何 auth 残留，所以不是过期 session 触发的 refresh）。
//   即「一次不需要发生的等待」。
//
//   判据：supabase 把 session 放在 `sb-<auth-hash>-auth-token`。读它只需同步
//   一次 localStorage，**不发网络、不进 supabase 内部锁**。
//     - 读不到 → 本机没登录过 → 直接跳登录页（这是绝大多数访问）
//     - 读到了 → 才走完整的 refresh()（真的可能是管理员，要问 whoami）
//   这样「未登录访问后台」变成同步判定，登录页瞬间出现。
let readyOnce = null;

/** 同步读本机是否有 session（不发网络）。读不到就是没登录过。 */
function hasStoredSession() {
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

export function requireAdmin(to) {
  // 快速路径：本机无 session，不必等 getSession()。
  //★ 置 ready=true 让后续导航不再重复判定（登录后 adminSignIn 会再 refresh）。
  if (!adminAuth.ready && !hasStoredSession()) {
    adminAuth.ready = true;
    adminAuth.user = null;
    adminAuth.isAdmin = false;
    return decide(to);
  }
  if (adminAuth.ready) return decide(to);
  if (!readyOnce) {
    readyOnce = Promise.race([
      refresh().then(() => adminAuth),
      // 兜底：网络挂住时按未登录放行到登录页（不能永不 resolve，
      // 那是 2026-10-07「页面停在预渲染内容上」的故障模式）。
      new Promise((r) => setTimeout(() => r(adminAuth), 3000)),
    ]);
  }
  return readyOnce.then(() => decide(to));
}

/** 按当前鉴权态给出去向。拆出来是为了 ready 与非 ready 两条路径共用同一判据。 */
function decide(to) {
  if (!adminAuth.user) {
    return {
      path: '/admin/login',
      query: to.fullPath !== '/admin' ? { redirect: to.fullPath } : {},
    };
  }
  if (!adminAuth.isAdmin) {
    return { path: '/admin/forbidden' };
  }
  return true;
}
