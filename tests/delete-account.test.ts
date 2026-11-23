/**
 * tests/delete-account.test.ts — 自助注销账户（ALNA-248）的本地侧契约。
 *
 * 钉死三件事：
 *   1. deleteAccount 只调 bsync_delete_account 且不带参数（服务端只认 auth.uid()，
 *      前端无从指定他人删除）；
 *   2. 成功路径：服务端已删账户 → 本地 signOut 失败也吞掉，会话与首屏缓存照清，
 *      并给成功 toast（本地书签不在任何删除路径上，「保留」由服务端级联范围保证）；
 *   3. 失败路径：danger toast 带上服务端错误（走 describeError，不丢信息），
 *      本地会话保留——用户还能看到失败原因并重试。
 * 另回归 logout：抽出 clearSessionState 共用清理后，原行为（info toast + 状态清空）不变。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  clearUiCache: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../src/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: h.getSession, signOut: h.signOut },
    rpc: h.rpc,
  },
}));
vi.mock('../src/lib/ext.js', () => ({
  api: {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
    runtime: { sendMessage: vi.fn(async () => ({})) },
    tabs: { create: vi.fn() },
    alarms: { create: vi.fn(), clear: vi.fn() },
  },
}));
vi.mock('../src/lib/uiCache.js', () => ({
  readUiCache: vi.fn(async () => null),
  writeUiCache: vi.fn(async () => {}),
  clearUiCache: h.clearUiCache,
}));
vi.mock('../src/lib/telemetry.js', () => ({ reportError: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast: h.toast }));
vi.mock('../src/sync.js', () => ({
  getProfile: vi.fn(),
  countServerBookmarks: vi.fn(),
  getBoundSpace: vi.fn(),
  hasLocalBinding: vi.fn(),
  createSpace: vi.fn(),
  deleteSpace: vi.fn(),
  renameSpace: vi.fn(),
  listDevices: vi.fn(),
  removeDevice: vi.fn(),
  renameDevice: vi.fn(),
  getDeviceId: vi.fn(),
  resetCoordinator: vi.fn(),
  FREE_ITEM_LIMIT: 1000,
}));
vi.mock('../src/sync/index.js', () => ({
  decryptMoveOp: vi.fn(),
  bindGateNeeded: false,
  isPaidPlan: vi.fn(() => false),
}));
vi.mock('../src/crypto.js', () => ({
  exportKey: vi.fn(),
  importKey: vi.fn(),
  hasKey: vi.fn(),
  setKeyFromPassphrase: vi.fn(),
  isFirstDevice: vi.fn(),
  clearLocalKey: vi.fn(),
  ensureLocalKey: vi.fn(),
}));

import { deleteAccount, logout, state } from '../src/store.js';

const FAKE_SESSION = { user: { id: 'u1' }, access_token: 'tok' } as never;

function seedSession(): void {
  // store.ts 的 state 是模块级 reactive——跨用例共享，逐例重置
  state.session = FAKE_SESSION;
  state.profile = { plan: 'free' } as never;
  state.spaces = [{ id: 's1' }] as never;
  state.devices = [{ id: 'd1' }] as never;
  state.activeSpace = 's1' as never;
  state.status = 'x';
}

beforeEach(() => {
  h.getSession.mockReset();
  h.signOut.mockReset();
  h.rpc.mockReset();
  h.clearUiCache.mockReset();
  Object.values(h.toast).forEach((fn) => fn.mockReset());
  h.getSession.mockResolvedValue({ data: { session: FAKE_SESSION } });
  h.signOut.mockResolvedValue({ error: null }); // supabase-js 恒返回 Promise
});

describe('deleteAccount 注销账户', () => {
  it('只调 bsync_delete_account 且不带参数（无法指定他人删除）', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    seedSession();
    await deleteAccount();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('bsync_delete_account');
  });

  it('成功：本地会话与首屏缓存清空，成功 toast，signOut 失败也吞掉', async () => {
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    h.signOut.mockRejectedValue(new Error('remote 401')); // 账户已删，远端 /logout 必然 401
    seedSession();
    await deleteAccount();
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.clearUiCache).toHaveBeenCalledTimes(1);
    expect(state.session).toBeNull();
    expect(state.profile).toBeNull();
    expect(state.spaces).toEqual([]);
    expect(h.toast.success).toHaveBeenCalledWith(
      'delacct_doneTitle',
      expect.objectContaining({ description: 'delacct_doneSub' }),
    );
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it('失败：danger toast 带服务端错误（不丢信息），本地会话保留', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'PGRST000' } });
    seedSession();
    await expect(deleteAccount()).rejects.toMatchObject({ message: 'boom' });
    expect(h.signOut).not.toHaveBeenCalled();
    expect(state.session).toEqual(FAKE_SESSION);
    expect(h.toast.error).toHaveBeenCalledWith(
      'delacct_failTitle',
      expect.objectContaining({ description: expect.stringContaining('boom') }),
    );
    expect(h.toast.success).not.toHaveBeenCalled();
  });
});

describe('logout 回归（抽出共用清理后行为不变）', () => {
  it('signOut + 清状态 + info toast', async () => {
    seedSession();
    await logout();
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(state.session).toBeNull();
    expect(state.status).toBe('toast_loggedOut');
    expect(h.toast.info).toHaveBeenCalledWith(
      'toast_loggedOut',
      expect.objectContaining({ duration: 3200 }),
    );
  });
});
