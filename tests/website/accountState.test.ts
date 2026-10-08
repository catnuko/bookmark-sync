// ============================================================
//官网账号状态回归测试
//
// 为什么必须有（2026-10-08 实测三处真实缺陷）：
//   1. signOut() 只置 user=null，不刷 profile → 登出后 plan/subscription 残留，
//      hasActiveSubscription() 仍为 true → 定价页把「订阅 Plus」显示成「管理/取消订阅」。
//   2. refreshProfile() 把 RLS/网络失败静默降级成 free→ 付费用户看到「订阅 Pro」
//      而再买一次钱。
//   3. plan 拉取失败时若落成 'free'，与「真的免费」不可区分（现用 null 区分）。
//
// 判据：**「读失败」与「读到了但是免费」必须可区分**。任何把两者合并的简化都会
// 让付费用户重复付款——这是钱的问题，不是显示问题。
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- mock supabase：可控的 auth + 表查询结果 ----
const authState = {
  user: null as { id: string; email?: string } | null,
  session: null as unknown,
};

type Result<T> = { data: T | null; error: { message: string } | null };

const tableResult: Record<string, Result<unknown>> = {
  bsync_profiles: { data: null, error: null },
  bsync_subscriptions: { data: null, error: null },
};

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const signOutMock = vi.fn(async () => {
  authState.user = null;
  authState.session = null;
});

// ★ mock 路径必须写成 website 侧那一份的**相对 specifier**，不能用裸包名。
//   原因：pnpm 硬链接下website/node_modules 与根 node_modules 指向同一个物理文件，
//   但 vitest 按「解析出的路径」建模块图 → 两个不同 module id。写裸包名只会替换掉
//   根目录那一份，website/lib/account.js 实际 import 的仍是真客户端 → 联网fetch
//   失败（表现为 account.error === 'TypeError: fetch failed'），测试假绿。
vi.mock('../../website/node_modules/@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: authState.session } }),
      onAuthStateChange: () => ({ data: { subscription: () => ({}) } }),
      signInWithPassword,
      signUp,
      signOut: signOutMock,
    },
    from: (table: string) => ({
      select: () => ({
        maybeSingle: async () => tableResult[table] ?? { data: null, error: null },
      }),
    }),
    functions: { invoke: vi.fn() },
  }),
}));

// account.js 在 import 时就会跑 getSession()（浏览器分支），故先定义 window。
// 注意不能写 `(window as ...).window = ...` —— node 环境下根本没有 window 这个绑定，
// 那一行自己就抛 ReferenceError。直接往 globalThis 上挂。
(globalThis as unknown as { window: unknown }).window = globalThis;

const { account, signOut, hasActiveSubscription, refreshProfileForTest } =
  await import('../../website/src/lib/account.js');

function setProfile(plan: string | null, sub?: Record<string, unknown> | null) {
  tableResult.bsync_profiles = {
    data: plan === null ? null : { plan },
    error: null,
  };
  tableResult.bsync_subscriptions = {
    data: sub ?? null,
    error: null,
  };
}

beforeEach(() => {
  authState.user = null;
  authState.session = null;
  signInWithPassword.mockReset();
  signUp.mockReset();
  account.user = null;
  account.plan = 'free';
  account.subscription = null;
  account.error = null;
  setProfile('free');
});

describe('官网账号状态', () => {
  it('signOut 必须清掉 plan/subscription（不能只置 user=null）', async () => {
    // 登录一个付费 Pro 用户
    authState.user = { id: 'u1', email: 'a@b.com' };
    account.user = authState.user;
    setProfile('pro', { plan: 'pro', status: 'active', current_period_end: '2027-01-01' });
    await refreshProfileForTest();
    expect(account.plan).toBe('pro');
    expect(hasActiveSubscription()).toBe(true);

    // 登出
    await signOut();

    // ★ 关键断言：残留会让定价页把「订阅 Plus」错显成「管理/取消订阅」
    expect(account.user).toBeNull();
    expect(account.plan).toBe('free');
    expect(account.subscription).toBeNull();
    expect(hasActiveSubscription()).toBe(false);
  });

  it('profile 拉取失败时报错并把 plan 置 null（≠ free），不静默降级', async () => {
    authState.user = { id: 'u2', email: 'c@d.com' };
    account.user = authState.user;
    tableResult.bsync_profiles = { data: null, error: { message: 'RLS denied' } };
    tableResult.bsync_subscriptions = { data: null, error: null };

    await refreshProfileForTest();

    // plan 必须是 null：落成 'free' 会让付费用户以为没买过、再付一次
    expect(account.plan).toBeNull();
    expect(account.plan).not.toBe('free');
    expect(account.error).toBe('RLS denied');
    expect(hasActiveSubscription()).toBe(false);
  });

  it('未登录时 refreshProfile 复位一切且不报错', async () => {
    account.user = null;
    account.plan = 'pro';
    account.subscription = { plan: 'pro', status: 'active' };
    account.error = 'x';

    await refreshProfileForTest();

    expect(account.plan).toBe('free');
    expect(account.subscription).toBeNull();
    expect(account.error).toBeNull();
  });

  it('status=past_due 仍算订阅有效（宽限期不停服）', () => {
    account.subscription = { plan: 'pro', status: 'past_due' };
    expect(hasActiveSubscription()).toBe(true);
    account.subscription = { plan: 'pro', status: 'canceled' };
    expect(hasActiveSubscription()).toBe(false);
  });
});
