// tests/sync/no-bookmarks-api.test.ts — 没有 bookmarks API 的环境不得让后台崩掉
//
// 回归背景（2026-10-20）：Firefox for Android **不支持** bookmarks API（MDN 兼容表
// 标 no support），而 manifest.firefox.json 通过 `gecko_android.strict_min_version`
// 允许了 Android 安装。于是 `globalThis.chrome.bookmarks` 是 undefined，
// `registerLocalEventBridge()` 里的 `chrome.onCreated.addListener` 抛 TypeError。
//
// 致命之处不是这个异常本身，而是**它发生的位置**：registerLocalEventBridge 在
// background.js 模块顶层被调用，异常会中断整个后台脚本的顶层执行 —— 后面的
// scheduleAlarms() / onStartup / onMessage 全部注册不上，插件从此彻底不工作。
// 线上实测：Android Firefox 用户的 refresh token 一直在续期（插件还装着），
// 但 bsync_devices 一条记录都没有（心跳从未发出），错误报表里
// `can't access property "onCreated", e is undefined` 的栈顶正是 background.js:2。
//
// 本测试锁死的行为：**没有 bookmarks API 时，registerLocalEventBridge 必须静默
// 返回而不是抛错**，让后台其余部分照常启动。

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  storage: {} as Record<string, unknown>,
}));

vi.mock('../../src/lib/ext.js', () => ({
  api: {
    storage: {
      local: {
        get: async () => h.storage,
        set: async (o: Record<string, unknown>) => Object.assign(h.storage, o),
        remove: async () => {},
      },
    },
    runtime: { getManifest: () => ({ version: '2.17.0' }) },
  },
}));

vi.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));

/** 模拟一个浏览器环境：`chrome` 存在，但 bookmarks 可能是 undefined。 */
function installChrome(bookmarks: unknown) {
  (globalThis as any).chrome = { bookmarks };
}

/** 带完整事件面的 bookmarks mock（用于「有 API 时应正常接线」的对照）。 */
function makeBookmarksApi() {
  const listeners: string[] = [];
  const on = (name: string) => ({
    addListener: () => {
      listeners.push(name);
    },
  });
  return {
    api: {
      onCreated: on('created'),
      onChanged: on('changed'),
      onMoved: on('moved'),
      onRemoved: on('removed'),
    },
    listeners,
  };
}

describe('registerLocalEventBridge 在缺少 bookmarks API 时', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('不抛错（否则 background.js 顶层中断，alarm/onStartup 全部注册不上）', async () => {
    installChrome(undefined);
    const { registerLocalEventBridge } = await import('../../src/sync.js');
    expect(() => registerLocalEventBridge()).not.toThrow();
  });

  it('不触碰任何 bookmarks 事件（bridge 未接线）', async () => {
    installChrome(undefined);
    const { registerLocalEventBridge } = await import('../../src/sync.js');
    registerLocalEventBridge();
    // 若实现改成「先解构再判空」，这里会因为读 undefined 而抛错 → 测试失败
    expect(() => registerLocalEventBridge()).not.toThrow();
  });

  it('对照：有 bookmarks API 时四个事件全部接线', async () => {
    const { api, listeners } = makeBookmarksApi();
    installChrome(api);
    const { registerLocalEventBridge } = await import('../../src/sync.js');
    registerLocalEventBridge();
    expect(listeners).toEqual(['created', 'changed', 'moved', 'removed']);
  });
});
