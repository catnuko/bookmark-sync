// tests/telemetry.test.ts — 错误上报（src/lib/telemetry.ts）
//
// 这个模块的**全部价值**在于「不添乱」：只上报元数据、未登录不发、失败静默、
// 同一错误风暴不放大。所以测试重点不是「发了什么」，而是**边界条件**：
// 未登录 / 已关闭 / 节流中 / rpc 抛错 —— 四种情况下都不能发出请求、不能抛错。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportError, setErrorReportEnabled } from '../src/lib/telemetry.js';

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  session: null as unknown,
  storage: {} as Record<string, unknown>,
  rpcError: null as unknown,
}));

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: h.session } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      return { data: null, error: h.rpcError };
    },
  },
}));

vi.mock('../src/lib/ext.js', () => ({
  api: {
    storage: {
      local: {
        get: async () => h.storage,
        set: async (o: Record<string, unknown>) => Object.assign(h.storage, o),
        remove: async () => {},
      },
    },
    runtime: { getManifest: () => ({ version: '2.4.0' }) },
  },
}));

// 模块级节流表在测试间不会重置 → 每个用例用**独立 phase**，且时钟**单调递增**
// （若把 now 回拨，`now - last` 为负 → 会被判成「仍在窗口内」而静默不发，
//  这正是本文件第一次跑时那个假失败的原因）
const PHASES = {
  unauthed: 'test-unauthed',
  happy: 'test-happy',
  off: 'test-off',
  throttle: 'test-throttle',
  throttleReason: 'test-throttle-reason',
  ctx: 'test-ctx',
  rpcErr: 'test-rpc-err',
  pref: 'test-pref',
  stackless: 'test-stackless',
};

let now = 1_000_000;

beforeEach(() => {
  h.rpcCalls.length = 0;
  h.session = { user: { id: 'u-1' } };
  h.rpcError = null;
  h.storage = {};
  now += 600_000; // 单调前进，绝不回拨
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  setErrorReportEnabled(true);
});

describe('reportError 的发出条件', () => {
  it('已登录 → 发一次，载荷形状正确', async () => {
    await reportError(PHASES.happy, 'error', new Error('boom'), { step: 'push' });

    expect(h.rpcCalls).toHaveLength(1);
    const { name, args } = h.rpcCalls[0];
    expect(name).toBe('bsync_error_report');
    expect(args.p_phase).toBe(PHASES.happy);
    expect(args.p_reason).toBe('error');
    expect(args.p_error_name).toBe('Error');
    expect(args.p_error_message).toBe('boom');
    expect(typeof args.p_error_stack).toBe('string');
    expect(args.p_context).toEqual({ step: 'push' });
    expect(args.p_app_version).toBe('2.4.0');
    expect(typeof args.p_platform).toBe('string');
  });

  it('未登录 → 一个请求都不发（服务端也会挡，但没必要白跑网络）', async () => {
    h.session = null;
    await reportError(PHASES.unauthed, 'error', new Error('boom'));
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('开关关闭 → 不发', async () => {
    setErrorReportEnabled(false);
    await reportError(PHASES.off, 'error', new Error('boom'));
    expect(h.rpcCalls).toHaveLength(0);
  });
});

describe('reportError 的节流与容错', () => {
  it('同一 phase 30 秒内只发一次；跨过窗口后恢复', async () => {
    await reportError(PHASES.throttle, 'error', new Error('a'));
    await reportError(PHASES.throttle, 'error', new Error('b'));
    expect(h.rpcCalls).toHaveLength(1);

    now += 30_000;
    await reportError(PHASES.throttle, 'error', new Error('c'));
    expect(h.rpcCalls).toHaveLength(2);
  });

  it('reason 不同则不被节流 —— 高发的 quota_exceeded 不许挤掉同一个真实崩溃', async () => {
    await reportError(PHASES.throttleReason, 'quota_exceeded', new Error('quota'));
    await reportError(PHASES.throttleReason, 'error', new Error('real crash'));
    expect(h.rpcCalls).toHaveLength(2);
    expect(h.rpcCalls[0].args.p_reason).toBe('quota_exceeded');
    expect(h.rpcCalls[1].args.p_reason).toBe('error');
  });

  it('rpc 失效时静默吞掉 —— 上报永不允许变成新的失败面', async () => {
    h.rpcError = new Error('network down');
    await expect(reportError(PHASES.rpcErr, 'error', new Error('x'))).resolves.toBeUndefined();
  });

  it('非 Error 抛出物走 describeError，不退化成 [object Object]', async () => {
    await reportError(PHASES.stackless, 'error', { code: 'P0001', hint: 'nope' });
    const { args } = h.rpcCalls[0];
    expect(args.p_error_message).toContain('P0001');
    expect(args.p_error_message).not.toContain('[object Object]');
  });
});

describe('context 白名单化（防误传整个 state）', () => {
  it('丢非标量、截断超长值、限制键数', async () => {
    await reportError(PHASES.ctx, 'error', new Error('x'), {
      ok: true,
      n: 42,
      deep: { a: 1 },
      arr: [1, 2],
      fn: () => {},
      nul: null,
      undef: undefined,
      long: 'x'.repeat(500),
      k1: 'a',
      k2: 'a',
      k3: 'a',
      k4: 'a',
      k5: 'a',
    });

    const ctx = h.rpcCalls[0].args.p_context as Record<string, string>;
    expect(ctx.ok).toBe('true');
    expect(ctx.n).toBe('42');
    expect(ctx).not.toHaveProperty('deep');
    expect(ctx).not.toHaveProperty('arr');
    expect(ctx).not.toHaveProperty('fn');
    expect(ctx).not.toHaveProperty('nul');
    expect(ctx).not.toHaveProperty('undef');
    expect((ctx.long ?? '').length).toBeLessThanOrEqual(120);
    expect(Object.keys(ctx).length).toBeLessThanOrEqual(10);
  });
});
