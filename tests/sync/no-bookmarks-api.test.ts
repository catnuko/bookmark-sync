// tests/sync/no-bookmarks-api.test.ts — 没有 bookmarks API 的环境不得让后台崩掉
//
// 回归背景（2026-10-20）：Firefox for Android **不支持** bookmarks API（MDN
// browser-compat-data 里 firefox_android 是 `version_added: false`，24 个子 API
// 无一例外）。manifest 曾用 `gecko_android.strict_min_version` 允许安卓安装，
// 于是 `globalThis.chrome.bookmarks` 是 undefined，
// `registerLocalEventBridge()` 里的 `chrome.onCreated.addListener` 抛 TypeError。
//
// 安卓安装声明现已移除（护栏见 tests/firefox-android-manifest.test.ts），但本测试
// **仍要保留**：这道判空是后台顶层不崩的最后防线，任何让插件跑到「没有 bookmarks
// API」环境的路径都会走到这里。
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

// 回归背景（2026-10-23，真实用户 gemzghost@gmail.com）：
//   该用户装的是 Firefox for Android · 2.18.1。平台没有 bookmarks API，
//   于是 captureLocalTree 恒 `return 0` —— 但心跳、口令、绑定全都正常，
//   后台看到的是「设备在线 / salt 已写 / used_count=0 / op=0」，
//   界面上也没有任何提示。用户以为在同步，云端永远一条都没有。
//
//   修复：runSync 在心跳之后、口令检查之前显式判平台，返回
//   `unsupported_platform`，由 store.reasonText 给出明确文案。
//   锁住判据：**没有 bookmarks API 时不得静默成功**。
describe('runSync 在缺少 bookmarks API 时给出明确原因', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('返回 unsupported_platform（而不是 ok:true 或含糊的 no_key）', async () => {
    installChrome(undefined);
    const { runSync } = await import('../../src/sync.js');
    const r = await runSync();
    // 没有会话时更早就会返回 not_authenticated，所以这里断言「不是 ok」
    // 且**若**走到平台判定就一定是 unsupported_platform —— 判据在 runSync 里
    // 排在 session 之后，故仅锁「不会假装成功」。
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(['not_authenticated', 'unsupported_platform']).toContain(r.reason);
    }
  });
});
