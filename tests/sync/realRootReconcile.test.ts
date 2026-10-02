/**
 * tests/sync/realRootReconcile.test.ts — 登录态切换「真账号根出现」的事件识别。
 *
 * 隐患：登出期账号子树落在「其他书签」下的回退文件夹里；登录后 Chrome 从 Google
 * 拉回真账号根。若不尽快退休回退，本机会同时显示两份（最长拖到下次 30 分钟同步）。
 *
 * 本文件固化事件桥的**识别口径**（sync.js / background.js 据此安排静默去抖收敛）：
 *   - 真账号根（syncing 子树、浏览器根的直接子节点、folderType 可识别）出现，
 *     且该落地根当前由回退文件夹代表 → onRealRootAppeared(landing, chromeId)；
 *   - 无回退 / 本地根 / 非根子节点 / folderType 认不出 → 不上报；
 *   - onAnyEvent 在每个事件都触发（静默去抖用）。
 *
 * 注意：这里只测「识别」。真正「等静默再同步」的时序在 background.ts，真机验证。
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  captureLocalEvents,
  IdBridge,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_UUID,
  OTHER_BOOKMARKS_UUID,
  ACCOUNT_BOOKMARKS_BAR_UUID,
  ACCOUNT_OTHER_BOOKMARKS_UUID,
} from '../../src/crdt/index.js';

const SPACE = 'dddddddd-0000-4000-8000-333333333333';

function makeChrome() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const api: ChromeBookmarksAPI = {
    getTree: async () => [],
    get: async () => [],
    create: async () => ({ id: 'x', title: '', parentId: '1' }),
    move: async () => ({ id: 'x', title: '', parentId: '1' }),
    update: async () => ({ id: 'x', title: '' }),
    remove: async () => {},
    removeTree: async () => {},
    getChildren: async () => [],
    onCreated: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.created ??= []).push(cb);
      },
    },
    onChanged: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.changed ??= []).push(cb);
      },
    },
    onMoved: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.moved ??= []).push(cb);
      },
    },
    onRemoved: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.removed ??= []).push(cb);
      },
    },
  };
  const emit = (name: string, ...args: any[]) => {
    for (const cb of listeners[name] ?? []) void cb(...args);
  };
  return { api, emit };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

async function setup(opts: { fallbacks?: Record<string, string> } = {}) {
  const chrome = makeChrome();
  const coord = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-root',
    transport: new MemoryOpLogTransport(),
    key: await generateKey(),
  });
  const bridge = new IdBridge(undefined, {
    roots: [
      ['0', ROOT_UUID],
      ['2', OTHER_BOOKMARKS_UUID],
    ],
  });
  if (opts.fallbacks) bridge.loadFallbacks(opts.fallbacks);
  const roots: string[] = [];
  const any: number[] = [];
  captureLocalEvents(
    chrome.api,
    () => coord,
    () => bridge,
    undefined,
    {
      onAnyEvent: () => any.push(1),
      onRealRootAppeared: (u, cid) => roots.push(`${u}@${cid}`),
    },
  );
  return { chrome, coord, bridge, roots, any };
}

const accountBarNode = (id: string): ChromeTreeNode => ({
  id,
  title: '账号书签栏',
  parentId: '0',
  folderType: 'bookmarks-bar',
  syncing: true,
});

describe('真账号根出现的事件识别（登录态切换收敛的触发点）', () => {
  it('真账号根出现 + 该落地根有回退 → 上报 landing uuid 与 chromeId', async () => {
    const { chrome, roots, any } = await setup({
      fallbacks: { [ACCOUNT_BOOKMARKS_BAR_UUID]: 'F' },
    });
    chrome.emit('created', '5', accountBarNode('5'));
    await tick();
    expect(roots).toEqual([`${ACCOUNT_BOOKMARKS_BAR_UUID}@5`]);
    expect(any.length).toBe(1);
  });

  it('真账号根出现但该落地根无回退（从未登出）→ 不上报', async () => {
    const { chrome, roots } = await setup();
    chrome.emit('created', '5', accountBarNode('5'));
    await tick();
    expect(roots).toEqual([]);
  });

  it('本地根（syncing:false）出现 → 不上报', async () => {
    const { chrome, roots } = await setup({
      fallbacks: { [ACCOUNT_BOOKMARKS_BAR_UUID]: 'F' },
    });
    chrome.emit('created', '1', {
      id: '1',
      title: '书签栏',
      parentId: '0',
      folderType: 'bookmarks-bar',
      syncing: false,
    });
    await tick();
    expect(roots).toEqual([]);
  });

  it('非浏览器根的直接子节点 → 不上报', async () => {
    const { chrome, roots } = await setup({
      fallbacks: { [ACCOUNT_OTHER_BOOKMARKS_UUID]: 'F' },
    });
    chrome.emit('created', '77', {
      id: '77',
      title: '普通文件夹',
      parentId: '2',
      folderType: 'other',
      syncing: true,
    });
    await tick();
    expect(roots).toEqual([]);
  });

  it('folderType 认不出（如受管书签）→ 不上报', async () => {
    const { chrome, roots } = await setup({
      fallbacks: { [ACCOUNT_BOOKMARKS_BAR_UUID]: 'F' },
    });
    chrome.emit('created', '9', {
      id: '9',
      title: '受管书签',
      parentId: '0',
      folderType: 'managed',
      syncing: true,
    });
    await tick();
    expect(roots).toEqual([]);
  });

  it('账号「其他书签」根也按同口径识别', async () => {
    const { chrome, roots } = await setup({
      fallbacks: { [ACCOUNT_OTHER_BOOKMARKS_UUID]: 'F' },
    });
    chrome.emit('created', '6', {
      id: '6',
      title: '账号其他书签',
      parentId: '0',
      folderType: 'other',
      syncing: true,
    });
    await tick();
    expect(roots).toEqual([`${ACCOUNT_OTHER_BOOKMARKS_UUID}@6`]);
  });

  it('普通书签创建不受影响：仍走正常捕获，且每个事件都触发 onAnyEvent', async () => {
    const { chrome, bridge, roots, any } = await setup();
    chrome.emit('created', 'n1', { id: 'n1', title: 'A', url: 'https://a', parentId: '2' });
    await tick();
    expect(roots).toEqual([]); // 不是根 → 不上报
    expect(any.length).toBe(1); // 但静默去抖计数照常
    expect(bridge.toUuid('n1')).not.toBeNull(); // 正常捕获
  });

  it('onAnyEvent 覆盖四类事件', async () => {
    const { chrome, any } = await setup();
    chrome.emit('created', 'n1', { id: 'n1', title: 'A', url: 'https://a', parentId: '2' });
    chrome.emit('changed', 'n1', { title: 'A2' });
    chrome.emit('moved', 'n1', { parentId: '2', oldParentId: '2', index: 0, oldIndex: 0 });
    chrome.emit('removed', 'n1', { removedNode: { id: 'n1', title: 'A2' } });
    await tick();
    expect(any.length).toBe(4);
  });

  it('冷启动：先 boot coordinator 再取桥，真根不被漏掉', async () => {
    const chrome = makeChrome();
    const coord = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'dev-cold-root',
      transport: new MemoryOpLogTransport(),
      key: await generateKey(),
    });
    const bridge = new IdBridge(undefined, { roots: [['0', ROOT_UUID]] });
    bridge.loadFallbacks({ [ACCOUNT_BOOKMARKS_BAR_UUID]: 'F' });
    // 模拟 SW 冷启动：coordinator 未 boot 前 _activeBridge 为 null；getC()
    // （= bootCoordinatorForEvent → ensureActiveBridge）跑完桥才可用。若事件
    // 处理器先取桥再 boot，账号根出现这一个事件会被漏掉（它只出现一次）。
    let booted = false;
    const roots: string[] = [];
    captureLocalEvents(
      chrome.api,
      () => {
        booted = true;
        return coord;
      },
      () => (booted ? bridge : null),
      undefined,
      { onRealRootAppeared: (u) => roots.push(u) },
    );
    chrome.emit('created', '5', accountBarNode('5'));
    await tick();
    expect(roots).toEqual([ACCOUNT_BOOKMARKS_BAR_UUID]);
  });
});
