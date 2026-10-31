// tests/feedback.test.ts — 用户主动反馈提交（src/lib/feedback.ts）
//
// 与 telemetry 的关键差异：反馈是**用户主动行为**，失败必须能被 UI 看见。
// 所以这里的重点是「结果码正确、且永不抛错」——而不是像 telemetry 那样断言静默。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitFeedback,
  buildMailto,
  SUPPORT_EMAIL,
  FEEDBACK_ISSUES_URL,
} from '../src/lib/feedback.js';

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  session: null as unknown,
  rpcData: null as unknown,
  rpcError: null as unknown,
  phase: '',
}));

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: h.session } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args });
      return { data: h.rpcData, error: h.rpcError };
    },
  },
}));

vi.mock('../src/lib/telemetry.js', () => ({
  appVersion: () => '2.7.0',
  platformTag: () => 'Chrome 137',
  getLastErrorPhase: () => h.phase,
}));

beforeEach(() => {
  h.rpcCalls.length = 0;
  h.session = { user: { id: 'u-1' } };
  h.rpcData = { ok: true, id: 1 };
  h.rpcError = null;
  h.phase = '';
});

describe('submitFeedback 的发出条件与结果码', () => {
  it('已登录 → 调 bsync_submit_feedback，载荷形状正确', async () => {
    const res = await submitFeedback({ kind: 'bug', body: '位置不对', contactEmail: 'a@b.com' });

    expect(res).toEqual({ ok: true });
    expect(h.rpcCalls).toHaveLength(1);
    const { name, args } = h.rpcCalls[0];
    expect(name).toBe('bsync_submit_feedback');
    expect(args.p_kind).toBe('bug');
    expect(args.p_body).toBe('位置不对');
    expect(args.p_contact_email).toBe('a@b.com');
    expect(args.p_app_version).toBe('2.7.0');
    expect(args.p_platform).toBe('Chrome 137');
    expect(args.p_last_error_phase).toBeNull();
  });

  it('有历史错误 → 带上最近 phase 作为排查上下文', async () => {
    h.phase = 'sync';
    await submitFeedback({ kind: 'bug', body: 'x' });
    expect(h.rpcCalls[0].args.p_last_error_phase).toBe('sync');
  });

  it('未填邮箱 → 传 null（不是空串）', async () => {
    await submitFeedback({ kind: 'idea', body: 'x' });
    expect(h.rpcCalls[0].args.p_contact_email).toBeNull();
  });

  it('未登录 → 一个请求都不发，直接返回 unauthenticated', async () => {
    h.session = null;
    const res = await submitFeedback({ kind: 'bug', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'unauthenticated' });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('服务端拒绝（限流）→ 透传 error 码', async () => {
    h.rpcData = { ok: false, error: 'rate_limited' };
    const res = await submitFeedback({ kind: 'bug', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('邮箱非法 → 透传 invalid_email', async () => {
    h.rpcData = { ok: false, error: 'invalid_email' };
    const res = await submitFeedback({ kind: 'bug', body: 'x', contactEmail: 'nope' });
    expect(res).toEqual({ ok: false, error: 'invalid_email' });
  });

  it('rpc 返回 error → network（永不抛错）', async () => {
    h.rpcError = new Error('network down');
    await expect(submitFeedback({ kind: 'bug', body: 'x' })).resolves.toEqual({
      ok: false,
      error: 'network',
    });
  });

  it('rpc 抛异常 → network（永不抛错）', async () => {
    h.rpcData = null;
    const res = await submitFeedback({ kind: 'bug', body: 'x' });
    expect(res).toEqual({ ok: false, error: 'network' });
  });
});

describe('buildMailto（未登录兜底）', () => {
  it('带上版本/平台，指向客服邮箱', () => {
    const href = buildMailto('Feedback', '正文');
    expect(href.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    expect(decodeURIComponent(href)).toContain('2.7.0');
    expect(decodeURIComponent(href)).toContain('Chrome 137');
    expect(decodeURIComponent(href)).toContain('正文');
  });
});

describe('GitHub Issues 链接', () => {
  it('指向反馈专用仓库 bookmark-sync-feedback 的 issues 页（不是主仓库）', () => {
    expect(FEEDBACK_ISSUES_URL).toBe('https://github.com/catnuko/bookmark-sync-feedback/issues');
  });
});
