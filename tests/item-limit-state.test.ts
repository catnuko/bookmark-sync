/**
 * tests/item-limit-state.test.ts — 条数超额必须是**持久状态**，不是一次性 toast。
 *
 * 回归背景（2026-10-22，真实用户 xyun0691@gmail.com）：
 *   该账号本机 2,828 条、免费档上限 1,000。首次上传全是创建 op，被
 *   syncEngine.flushPush 的条数闸门全部拦下 → 云端 bsync_op_log 0 行、
 *   bsync_profiles.used_bytes = 0。而 used_count 由客户端无条件上报（0018），
 *   所以后台看到的正是「条数 2,828 / 用量 0 B」这种自相矛盾的行。
 *
 *   根因之一在界面：`itemLimitBlocked` 只是 runSync 的瞬时返回值，popup 弹一次
 *   toast 就没了。刷新界面后**看不出任何异常**（状态显示「同步完成」），用户与
 *   客服都不知道云端其实一条都没有。
 *
 * 本文件锁住三件事：
 *   1) SyncCoordinator 在拦截时 itemLimitBlocked = true 且 op 一个不丢（底层契约）
 *   2) store 的 quotaState 在「被挡」时判为 over（哪怕比值还没超 100%）
 *   3) store 的 quotaFoot 使用「尚未上传」文案，而不是含糊的「请升级后继续同步」
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryOpLogTransport, SyncCoordinator } from '../src/sync/index.js';
import { generateKey, ROOT_NODE_ID } from '../src/crdt/index.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-333333333333';

let store: Record<string, unknown>;

function installChrome(): void {
  const local = {
    get: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = {
    storage: { local },
    // 文案原样返回键名，断言才能覆盖到「用了哪个键」而不是文案本身
    i18n: { getMessage: (k: string) => k, getUILanguage: () => 'zh-CN' },
  };
}

beforeEach(() => {
  store = {};
  installChrome();
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

async function makeCoordinator(itemLimit?: number) {
  const transport = new MemoryOpLogTransport();
  const key = await generateKey();
  const c = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-itemlimit',
    transport,
    key,
    itemLimit,
  });
  return { c, transport };
}

function seedBookmarks(c: SyncCoordinator, n: number): void {
  for (let i = 0; i < n; i++) {
    c.createNode(ROOT_NODE_ID, { title: `b${i}`, url: `https://example.com/${i}` });
  }
}

describe('SyncCoordinator 层：超限拦截后 op 必须留在队列', () => {
  it('云端 0 行、队列非空 —— 这就是「用量 0 B 却有 2,828 条」的现场', async () => {
    const { c, transport } = await makeCoordinator(3);
    seedBookmarks(c, 5);

    expect(await c.flushPush()).toBe(0);
    expect((await transport.pull(SPACE, 0)).rows.length).toBe(0); // 云端空
    expect(c.pendingPushCount).toBe(5); // 但也没丢
    expect(c.itemLimitBlocked).toBe(true);
  });
});

describe('store 层：被挡时配额卡必须判 over 并说清「未上传」', () => {
  it('itemLimitBlocked 时 quotaState = over（即使条数比值未到 100%）', async () => {
    vi.resetModules();
    const s = await import('../src/store.js');
    // 1,050 / 1,000 = 105% → 本来也是 over；改用 0 条 + 被挡标记来证明
    // 判据来自 itemLimitState 本身，而不是比值。
    s.state.profile = { plan: 'free', quota_bytes: 5242880, used_bytes: 0, used_count: 0 };
    s.state.itemLimitState = null;
    expect(s.quotaState.value).toBe('ok');

    s.state.itemLimitState = { pending: 5, limit: 1000, at: Date.now() };
    expect(s.quotaState.value).toBe('over');
    expect(s.itemLimitBlocked.value).toBe(true);
  });

  it('被挡时 quotaFoot 用 quota_footOverBlocked（点明尚未上传）', async () => {
    vi.resetModules();
    const s = await import('../src/store.js');
    s.state.profile = { plan: 'free', quota_bytes: 5242880, used_bytes: 0, used_count: 2828 };
    s.state.itemLimitState = { pending: 8462, limit: 1000, at: Date.now() };

    // t() 在测试里原样返回键名，所以这里断言的是「选用了哪个文案键」
    expect(s.quotaFoot.value).toContain('quota_footOverBlocked');
  });

  it('未被挡时仍用旧的 quota_footOver（不误伤只是超额但还能推的旧状态）', async () => {
    vi.resetModules();
    const s = await import('../src/store.js');
    s.state.profile = { plan: 'free', quota_bytes: 5242880, used_bytes: 0, used_count: 1200 };
    s.state.itemLimitState = null;

    expect(s.quotaFoot.value).toContain('quota_footOver');
    expect(s.quotaFoot.value).not.toContain('quota_footOverBlocked');
  });
});
