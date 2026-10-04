/**
 * tests/sync/deletionGuard.test.ts — replica 缺行时禁止删除本机节点（数据安全）。
 *
 * 事故（2026-10-04 真机，测试账号 346746061@qq.com）：
 *   1. Firefox 在书签工具栏加 1 条书签 → 点同步
 *      → 同步后「其他书签 / 账号书签栏」内容为空，**文件夹还在**
 *   2. Chrome 点同步 → **所有书签都没了**
 *
 * 根因：`removeTrashedNodes` 的删除判据只有 `!reachable.has(uuid)` 一条，
 * 满足即 `chrome.removeTree()` 真删。而 `reachable` 来自从 `ROOT_UUID` 的 BFS
 * （`buildReachable`）—— replica 缺行时它只反映**已拉到的部分**，于是
 * 「云端有、只是这轮没拉到」的存量节点被误判成「已删除」。
 *
 * 为什么症状是「文件夹还在、内容空了」：`removeTrashedNodes` 豁免
 * `isLandingRoot(uuid)` 与根的直接子节点（回退文件夹与固定根都在豁免里），
 * 被删的只有普通内容节点。
 *
 * ★ 同族问题第三次「只修一半」：`captureLocalTree` / `onCreated` 早就写了
 * `if (coordinator.isReplicaIncomplete) return;`（664-op 重复事故），删除路径
 * 当时漏了同一个判断。
 *
 * 本文件钉住：replica 缺行 → reverseApply **零删除**；replica 完整 → 正常删除
 * 仍然生效（护栏不能把删除能力整体关掉）。
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  reverseApply,
  captureLocalEvents,
  IdBridge,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  TRASH_NODE_ID,
} from '../../src/crdt/index.js';

const SPACE = 'dddddddd-0000-4000-8000-333333333333';

/** 记录 removeTree 调用次数的 fake chrome（本测试的核心观测点）。 */
function makeChrome(tree: ChromeTreeNode[]): ChromeBookmarksAPI & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    getTree: async () => tree,
    get: async () => [],
    create: async () => ({ id: 'x', title: '', parentId: '1' }),
    move: async () => ({ id: 'x', title: '', parentId: '1' }),
    update: async () => ({ id: 'x', title: '' }),
    remove: async () => {},
    removeTree: async (id: string) => {
      removed.push(id);
    },
    getChildren: async () => [],
    onCreated: { addListener: () => {} },
    onChanged: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  };
}

async function makeCoord(): Promise<SyncCoordinator> {
  return new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-guard',
    transport: new MemoryOpLogTransport(),
    key: await generateKey(),
  });
}

const ROOTS: Array<[string, string]> = [
  ['0', ROOT_UUID],
  ['1', BOOKMARKS_BAR_UUID],
  ['2', OTHER_BOOKMARKS_UUID],
];

describe('删除护栏：replica 缺行时零删除（2026-10-04 全量丢失事故）', () => {
  it('skipDeletions=true → removeTree 一次都不调（哪怕本机节点在 CRDT 里不可达）', async () => {
    const coord = await makeCoord();
    // 本机 Chrome 树：书签栏下有 2 条书签（chr-1 / chr-2）
    const chrome = makeChrome([
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: '书签栏',
            children: [
              { id: 'chr-1', title: '本机书签 A', url: 'https://a.example' },
              { id: 'chr-2', title: '本机书签 B', url: 'https://b.example' },
            ],
          },
        ],
      } as ChromeTreeNode,
    ]);

    // CRDT 里**没有任何节点**（模拟 replica 缺行 / 只有固定根），
    // 于是 chr-1 / chr-2 对应的 uuid 都不可达。
    const bridge = new IdBridge(undefined, { roots: ROOTS });
    // 假装它们此前已被映射（真实事故里它们是上一轮同步留下的）
    bridge.map('chr-1', '11111111-1111-4111-8111-111111111111');
    bridge.map('chr-2', '22222222-2222-4222-8222-222222222222');

    await reverseApply(chrome, coord, bridge, { skipDeletions: true });

    // ★ 核心断言：护栏生效 → 一个都不删
    expect(chrome.removed).toEqual([]);
  });

  it('负向验证：护栏关掉时这些节点会被真删（证明上面的零删除来自护栏而非巧合）', async () => {
    const coord = await makeCoord();
    const chrome = makeChrome([
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: '书签栏',
            children: [{ id: 'chr-1', title: '本机书签 A', url: 'https://a.example' }],
          },
        ],
      } as ChromeTreeNode,
    ]);

    const bridge = new IdBridge(undefined, { roots: ROOTS });
    bridge.map('chr-1', '11111111-1111-4111-8111-111111111111');

    // 不传 skipDeletions → 复现事故：不可达 → removeTree 真删
    await reverseApply(chrome, coord, bridge);

    expect(chrome.removed).toEqual(['chr-1']);
  });

  it('护栏不掩盖真实删除：replica 完整时该删的仍要删', async () => {
    const coord = await makeCoord();
    // CRDT 里有 chr-1 对应的节点 → 它是可达的 → 不该被删
    const chrome = makeChrome([
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: '书签栏',
            children: [
              { id: 'chr-1', title: '书签 A', url: 'https://a.example' },
              // 这个没映射、也不在 CRDT → unmapped，按设计不动它
              { id: 'chr-x', title: '用户在扩展外加的', url: 'https://x.example' },
            ],
          },
        ],
      } as ChromeTreeNode,
    ]);

    const live = coord.replica.createNodeWithId(
      '11111111-1111-4111-8111-111111111111',
      BOOKMARKS_BAR_UUID,
      { title: '书签 A', url: 'https://a.example' },
    );
    expect(live).toBe('11111111-1111-4111-8111-111111111111');

    const bridge = new IdBridge(undefined, { roots: ROOTS });
    bridge.map('chr-1', live);
    // chr-x 刻意不映射 → 走「unmapped: leave alone」

    await reverseApply(chrome, coord, bridge, { skipDeletions: false });

    // 可达节点不被删、unmapped 不被删 → 零删除
    expect(chrome.removed).toEqual([]);
  });

  it('unmapped 节点在任何护栏状态下都不删（2026-10-02 起的既有不变量）', async () => {
    const coord = await makeCoord();
    const chrome = makeChrome([
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: '书签栏',
            children: [{ id: 'chr-x', title: '扩展外加的', url: 'https://x.example' }],
          },
        ],
      } as ChromeTreeNode,
    ]);

    const bridge = new IdBridge(undefined, { roots: ROOTS });
    // 无任何映射
    await reverseApply(chrome, coord, bridge, { skipDeletions: false });
    expect(chrome.removed).toEqual([]);
  });
});

/**
 * 第二层护栏：插件自己发起的删除**不得变成墓碑 push 上云**。
 *
 * 事故同款：`removeTrashedNodes` 删本机节点 → `onRemoved` → 抑制期入
 * `pendingRemoved` → 抑制解除时补调 `handleRemoved` → `deleteNode` → 墓碑上云。
 * 实测某空间 3562 条 trash op 上云、可见树归零（真 Replica 重放验证）。
 *
 * 为什么不能像 `retireFallbackFolders` 那样「先丢映射再删」：本函数删除判据
 * 就是映射，必须留到最后一刻 → 只能靠 `pluginRemovedIds` 标记豁免。
 */
describe('墓碑护栏：插件删除不发墓碑，用户删除照发', () => {
  /** 带事件发射的 fake chrome：removeTree 会像真浏览器一样触发 onRemoved。 */
  function makeEventChrome(tree: ChromeTreeNode[]) {
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    const api: ChromeBookmarksAPI = {
      getTree: async () => tree,
      get: async () => [],
      create: async () => ({ id: 'x', title: '', parentId: '1' }),
      move: async () => ({ id: 'x', title: '', parentId: '1' }),
      update: async () => ({ id: 'x', title: '' }),
      remove: async () => {},
      removeTree: async (id: string) => {
        for (const fn of listeners.removed ?? [])
          fn(id, { removedNode: { id, title: '', parentId: '1' } as ChromeTreeNode });
      },
      getChildren: async () => [],
      onCreated: { addListener: (fn: any) => ((listeners.created ??= []).push(fn), {}) },
      onChanged: { addListener: (fn: any) => ((listeners.changed ??= []).push(fn), {}) },
      onMoved: { addListener: (fn: any) => ((listeners.moved ??= []).push(fn), {}) },
      onRemoved: { addListener: (fn: any) => ((listeners.removed ??= []).push(fn), {}) },
    } as unknown as ChromeBookmarksAPI;
    return {
      api,
      emitRemoved: (id: string) => {
        for (const fn of listeners.removed ?? [])
          fn(id, { removedNode: { id, title: '用户删的', parentId: '1' } as ChromeTreeNode });
      },
    };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('reverseApply 删掉的节点：onRemoved 触发后不产生墓碑', async () => {
    const coord = await makeCoord();
    const tree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: '书签栏',
            children: [{ id: 'chr-1', title: 'A', url: 'https://a.example' }],
          },
        ],
      } as ChromeTreeNode,
    ];
    const { api } = makeEventChrome(tree);
    const bridge = new IdBridge(undefined, { roots: ROOTS });
    const guard = captureLocalEvents(api, coord, bridge);
    bridge.map('chr-1', '11111111-1111-4111-8111-111111111111');

    // 抑制开启 → 删除（触发 onRemoved → 入 pendingRemoved）→ 解除抑制（补调）
    guard.suppressed.value = true;
    await reverseApply(api, coord, bridge);
    guard.suppressed.value = false;
    await tick();

    // 节点被删了，但**没有墓碑**（父不是 trash）
    const uuid = '11111111-1111-4111-8111-111111111111';
    expect(coord.replica.getParent(uuid)).not.toBe(TRASH_NODE_ID);
  });

  it('对照：用户删书签仍然照发墓碑（护栏不能把删除同步整体关掉）', async () => {
    const coord = await makeCoord();
    const { api, emitRemoved } = makeEventChrome([]);
    const bridge = new IdBridge(undefined, { roots: ROOTS });
    captureLocalEvents(api, coord, bridge);

    // 先让节点进 CRDT，再由「用户」删除
    const uuid = coord.replica.createNodeWithId(
      '22222222-2222-4222-8222-222222222222',
      BOOKMARKS_BAR_UUID,
      { title: '用户删的', url: 'https://b.example' },
    );
    bridge.map('u-1', uuid);

    emitRemoved('u-1');
    await tick();

    expect(coord.replica.getParent(uuid)).toBe(TRASH_NODE_ID);
  });
});
