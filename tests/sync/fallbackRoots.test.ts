/**
 * tests/sync/fallbackRoots.test.ts — 回退文件夹记录不得污染原生根。
 *
 * 回归：Chrome 双子树下「登录且本地子树为空」时本地根被隐藏 —— 它不在
 * `getTree()`、不在 rootResolver 的 pairs 里、也不在 `protectedIds` 里。
 * 旧 `IdBridge.load` 把 idmap 里每条「落地根映射」一律记成回退，于是本地根
 * '1'/'2' 进了 `fallbackChromeIds`。等登出、本地根重新可见时，
 * `captureLocalTree` 的 walk 命中 `isFallbackChromeId(node.id)` → 整棵本地
 * 子树被跳过，本地书签永不捕获（2026-10-02 真机实测）。
 *
 * 本文件固化两条不变量：
 *   1. 原生根 chromeId 永远不是回退占位（load / loadFallbacks / markFallback）；
 *   2. 真正的回退占位（动态 chromeId）被识别：captureLocalTree **不建它自身的
 *      节点**，但递归其子树到落地根 uuid —— 已映射子节点不重复捕获，未映射
 *      （用户新加）子节点被捕获。
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  captureLocalTree,
  IdBridge,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  ACCOUNT_BOOKMARKS_BAR_UUID,
} from '../../src/crdt/index.js';

const SPACE = 'eeeeeeee-0000-4000-8000-444444444444';

function makeChrome(tree: ChromeTreeNode[]): ChromeBookmarksAPI {
  return {
    getTree: async () => tree,
    get: async () => [],
    create: async () => ({ id: 'x', title: '', parentId: '1' }),
    move: async () => ({ id: 'x', title: '', parentId: '1' }),
    update: async () => ({ id: 'x', title: '' }),
    remove: async () => {},
    removeTree: async () => {},
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
    deviceId: 'dev-fb',
    transport: new MemoryOpLogTransport(),
    key: await generateKey(),
  });
}

describe('回退文件夹记录不得污染原生根', () => {
  it('load：登录后本地根被隐藏（不在 protectedIds）时，原生根映射不被记成回退', () => {
    // 模拟「已登录且本地为空」：本环境只解析出浏览器根 + 账号根
    const bridge = new IdBridge(undefined, {
      roots: [
        ['0', ROOT_UUID],
        ['4466', ACCOUNT_BOOKMARKS_BAR_UUID],
      ],
    });
    // 上一轮（登出期）持久化的 idmap：本地根 '1'/'2' 是当时的落地根
    bridge.load({
      '0': ROOT_UUID,
      '1': BOOKMARKS_BAR_UUID,
      '2': OTHER_BOOKMARKS_UUID,
      '4466': ACCOUNT_BOOKMARKS_BAR_UUID,
    });
    expect(bridge.isFallbackChromeId('1')).toBe(false);
    expect(bridge.isFallbackChromeId('2')).toBe(false);
    expect(bridge.fallbackFor(BOOKMARKS_BAR_UUID)).toBeNull();
    expect(bridge.fallbackFor(OTHER_BOOKMARKS_UUID)).toBeNull();
    // 隐藏的原生根不落地映射（真根缺席，等它重新出现时由 resolveRoots seed）
    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBeNull();
    // 真账号根照旧 seed，不受影响
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('4466');
  });

  it('loadFallbacks：已污染的持久化记录（原生根）被过滤，自愈', () => {
    const bridge = new IdBridge(undefined, { roots: [['0', ROOT_UUID]] });
    bridge.loadFallbacks({
      [BOOKMARKS_BAR_UUID]: '1',
      [OTHER_BOOKMARKS_UUID]: '2',
      [ACCOUNT_BOOKMARKS_BAR_UUID]: 'F', // 真正的回退占位：保留
    });
    expect(bridge.isFallbackChromeId('1')).toBe(false);
    expect(bridge.isFallbackChromeId('2')).toBe(false);
    expect(bridge.isFallbackChromeId('F')).toBe(true);
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('F');
    expect(bridge.fallbackSnapshot()).toEqual({ [ACCOUNT_BOOKMARKS_BAR_UUID]: 'F' });
  });

  it('markFallback：原生根被拒绝登记，动态占位正常登记', () => {
    const bridge = new IdBridge(undefined, { roots: [['0', ROOT_UUID]] });
    bridge.markFallback(BOOKMARKS_BAR_UUID, '1');
    expect(bridge.isFallbackChromeId('1')).toBe(false);
    bridge.markFallback(ACCOUNT_BOOKMARKS_BAR_UUID, 'F');
    expect(bridge.isFallbackChromeId('F')).toBe(true);
  });

  it('端到端：污染的持久化记录不会让 captureLocalTree 跳过本地子树', async () => {
    // 登出态：本地根 '1'/'2' 可见，'1' 下有一个书签
    const tree: ChromeTreeNode[] = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: '书签栏',
            parentId: '0',
            folderType: 'bookmarks-bar',
            syncing: false,
            children: [{ id: 'u1', title: '本地书签', url: 'https://local', parentId: '1' }],
          },
          { id: '2', title: '其他书签', parentId: '0', folderType: 'other', syncing: false },
        ],
      },
    ];
    const bridge = new IdBridge(undefined, {
      roots: [
        ['0', ROOT_UUID],
        ['1', BOOKMARKS_BAR_UUID],
        ['2', OTHER_BOOKMARKS_UUID],
      ],
    });
    // 模拟上一轮「登录态」留下的污染：idmap + fallbackRoots 都把 '1'/'2' 当回退
    bridge.load({ '0': ROOT_UUID, '1': BOOKMARKS_BAR_UUID, '2': OTHER_BOOKMARKS_UUID });
    bridge.loadFallbacks({ [BOOKMARKS_BAR_UUID]: '1', [OTHER_BOOKMARKS_UUID]: '2' });

    const coord = await makeCoord();
    const captured = await captureLocalTree(makeChrome(tree), coord, bridge);
    expect(captured).toBe(1); // 本地书签被捕获（旧版此处为 0：整棵子树被跳过）
    const uuid = bridge.toUuid('u1');
    expect(uuid).toBeTruthy();
    expect(coord.replica.getParent(uuid!)).toBe(BOOKMARKS_BAR_UUID);
  });

  it('回退占位：已映射子节点不被重复捕获（递归进落地根，无新 op）', async () => {
    const tree: ChromeTreeNode[] = [
      {
        id: '0',
        title: '',
        children: [
          { id: '2', title: '其他书签', parentId: '0', folderType: 'other', syncing: false },
          {
            id: 'F',
            title: '账号书签栏',
            parentId: '2',
            children: [{ id: 'a1', title: '账号书签', url: 'https://acct', parentId: 'F' }],
          },
        ],
      },
    ];
    const bridge = new IdBridge(undefined, {
      roots: [
        ['0', ROOT_UUID],
        ['2', OTHER_BOOKMARKS_UUID],
      ],
    });
    bridge.markFallback(ACCOUNT_BOOKMARKS_BAR_UUID, 'F');
    bridge.map('F', ACCOUNT_BOOKMARKS_BAR_UUID);
    const coord = await makeCoord();
    // 模拟 reverseApply 已把账号内容投影进回退文件夹：a1 已映射到 CRDT 节点
    coord.createNodeWithId('acc-a1', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '账号书签',
      url: 'https://acct',
    });
    bridge.map('a1', 'acc-a1');

    const captured = await captureLocalTree(makeChrome(tree), coord, bridge);
    expect(captured).toBe(0); // 已映射 → existing 分支，不产生新 op
    expect(bridge.toUuid('a1')).toBe('acc-a1');
  });

  it('回退占位：用户新加的未映射子节点被捕获到落地根下', async () => {
    const tree: ChromeTreeNode[] = [
      {
        id: '0',
        title: '',
        children: [
          { id: '2', title: '其他书签', parentId: '0', folderType: 'other', syncing: false },
          {
            id: 'F',
            title: '账号书签栏',
            parentId: '2',
            children: [{ id: 'u1', title: '用户新加的', url: 'https://user-added', parentId: 'F' }],
          },
        ],
      },
    ];
    const bridge = new IdBridge(undefined, {
      roots: [
        ['0', ROOT_UUID],
        ['2', OTHER_BOOKMARKS_UUID],
      ],
    });
    bridge.markFallback(ACCOUNT_BOOKMARKS_BAR_UUID, 'F');
    bridge.map('F', ACCOUNT_BOOKMARKS_BAR_UUID);
    const coord = await makeCoord();

    const captured = await captureLocalTree(makeChrome(tree), coord, bridge);
    expect(captured).toBe(1); // 旧实现整棵跳过 → 0（书签静默不同步）
    const uuid = bridge.toUuid('u1');
    expect(uuid).toBeTruthy();
    expect(coord.replica.getParent(uuid!)).toBe(ACCOUNT_BOOKMARKS_BAR_UUID);
  });

  it('回退占位：映射丢失但内容命中存量节点时应认领，不新建（防重复书签）', async () => {
    // 真机症状（2026-10-04）：回退文件夹子树被递归后，本机映射缺失（SW 冷启动 /
    // 落盘窗口）→ 若按内容认领失败就会给存量节点造出重复副本。
    const tree: ChromeTreeNode[] = [
      {
        id: '0',
        title: '',
        children: [
          { id: '2', title: '其他书签', parentId: '0', folderType: 'other', syncing: false },
          {
            id: 'F',
            title: '账号书签栏',
            parentId: '2',
            children: [
              {
                id: 'b1',
                title: 'jquery插件',
                parentId: 'F',
                children: [{ id: 'a1', title: '某书签', url: 'https://x', parentId: 'b1' }],
              },
            ],
          },
        ],
      },
    ];
    const bridge = new IdBridge(undefined, {
      roots: [
        ['0', ROOT_UUID],
        ['2', OTHER_BOOKMARKS_UUID],
      ],
    });
    bridge.markFallback(ACCOUNT_BOOKMARKS_BAR_UUID, 'F');
    bridge.map('F', ACCOUNT_BOOKMARKS_BAR_UUID);
    const coord = await makeCoord();
    // 存量 CRDT：账号根 → 文件夹 b1 → 书签 a1（与本地同内容）
    coord.createNodeWithId('b1-uuid', ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'jquery插件' });
    coord.createNodeWithId('acc-a1', 'b1-uuid', { title: '某书签', url: 'https://x' });
    // ⚠ 故意不给 b1 / a1 任何映射：模拟 idmap 丢失

    const captured = await captureLocalTree(makeChrome(tree), coord, bridge);
    expect(captured).toBe(0); // 应认领存量节点，而非新建重复
    expect(bridge.toUuid('b1')).toBe('b1-uuid');
    expect(bridge.toUuid('a1')).toBe('acc-a1');
  });
});
