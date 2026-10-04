/**
 * tests/sync/crossBrowser.test.ts — 跨浏览器（Chrome ↔ Edge ↔ Firefox）落地逻辑。
 *
 * 背景：Chrome 2025-06 起把书签拆成「账号(syncing) / 本地」两棵子树；Edge 是
 * Chromium 但没有账号存储（单树）；Firefox 是另一套根模型（guid、无 folderType /
 * syncing）。三家用同一个 CRDT 空间互同步时，各家的落地根集合不同 —— 本文件把
 * 「差集怎么处理」钉死：
 *
 *   - 某个落地根在本机**没有真根**时，`reverseApply` 会在**本地「其他书签」**下建
 *     一个同名回退文件夹承载它（内容不丢，但位置会变）。
 *   - 反过来，如果本机**连本地「其他书签」都没有**（Chrome「已登录 + 本地为空」），
 *     内容就无处落地 —— 只能跳过 + 报给调用方（`onUnplaceableRoot`），**不许**落到
 *     账号子树（会被上传到 Google 账号 + 云端翻倍）。
 *   - 回退文件夹**自身**不被 `captureLocalTree` 建节点，但其**子树被递归进落地根
 *     uuid** —— 已投影的内容不重复捕获，用户在回退文件夹里新加的书签则正常同步
 *     出去。Firefox/Edge 上这个回退文件夹是**永久**的（账号根永远不会出现），
 *     所以这条比 Chrome 更容易被踩到（旧实现整棵跳过 → 静默不同步）。
 *   - Firefox 首次运行的内置默认书签（`unfiled_____` 下标题恰为 `Mozilla Firefox`
 *     的文件夹 + 4 条固定 Mozilla 链接）**不入 CRDT**（按内容指纹识别）。
 *
 * 这些是纯逻辑，用 mock 书签树验证，不需要真浏览器。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  IdBridge,
  reverseApply,
  captureLocalTree,
  resolveRoots,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
  ACCOUNT_BOOKMARKS_BAR_UUID,
  ACCOUNT_OTHER_BOOKMARKS_UUID,
  ACCOUNT_MOBILE_UUID,
} from '../../src/crdt/index.js';

const SPACE = 'cccccccc-0000-4000-8000-222222222222';

interface RootSpec {
  id: string;
  title: string;
  folderType?: string;
  syncing?: boolean;
}

/**
 * 忠实模拟一个浏览器的 chrome.bookmarks（根 id / 根子节点形状可配）：
 *   - create 按 index 插入（不是 push）；
 *   - 根不可作父、永久节点不可改（真实 Chrome/Firefox 都会抛
 *     "Can't modify the root bookmark folders."）。
 */
function makeMock(rootId: string, rootChildren: RootSpec[]): ChromeBookmarksAPI {
  interface N extends ChromeTreeNode {
    parentId?: string;
    index?: number;
    url?: string;
  }
  const tree = new Map<string, N>();
  const seed = (n: N, parentId?: string) => {
    if (parentId !== undefined && n.parentId === undefined) n.parentId = parentId;
    tree.set(n.id, n);
    for (const c of n.children ?? []) seed(c, n.id);
  };
  const ROOTS: N[] = [
    {
      id: rootId,
      title: '',
      children: rootChildren.map((r, i) => ({ ...r, parentId: rootId, index: i, children: [] })),
    },
  ];
  for (const r of ROOTS) seed(r);
  let seq = 0;

  const PERMANENT = new Set([rootId, ...rootChildren.map((r) => r.id)]);
  const MODIFY_ROOT_ERROR = "Can't modify the root bookmark folders.";
  const assertParentModifiable = (parentId: string) => {
    if (parentId === rootId) throw new Error(MODIFY_ROOT_ERROR);
  };
  const assertNodeModifiable = (id: string) => {
    if (PERMANENT.has(id)) throw new Error(MODIFY_ROOT_ERROR);
  };

  return {
    getTree: async () => {
      const clone = (n: N): N => ({ ...n, children: (n.children ?? []).map(clone) });
      return ROOTS.map(clone);
    },
    get: async () => [],
    getChildren: async (parentId: string) =>
      (tree.get(parentId)?.children ?? []).map((c) => ({ ...c })),
    create: async (props: { parentId: string; title?: string; url?: string; index?: number }) => {
      assertParentModifiable(props.parentId);
      const id = 'n' + ++seq;
      const parent = tree.get(props.parentId)!;
      const kids = (parent.children ??= []);
      const idx = Math.min(props.index ?? kids.length, kids.length);
      const node: N = {
        id,
        parentId: props.parentId,
        index: idx,
        title: props.title ?? '',
        url: props.url,
        children: [],
      };
      kids.splice(idx, 0, node);
      kids.forEach((c, i) => (c.index = i));
      tree.set(id, node);
      return { ...node, index: idx };
    },
    move: async (id: string, moveProps: { parentId: string; index?: number }) => {
      assertNodeModifiable(id);
      assertParentModifiable(moveProps.parentId);
      const node = tree.get(id)!;
      const oldParent = tree.get(node.parentId!)!;
      oldParent.children = oldParent.children!.filter((c) => c.id !== id);
      node.parentId = moveProps.parentId;
      const np = tree.get(moveProps.parentId)!;
      const idx = Math.min(moveProps.index ?? np.children!.length, np.children!.length);
      np.children!.splice(idx, 0, node);
      np.children!.forEach((c, i) => (c.index = i));
      return { ...node, parentId: moveProps.parentId, index: idx };
    },
    update: async (id: string, changes: { title?: string; url?: string }) => {
      assertNodeModifiable(id);
      const node = tree.get(id)!;
      if (changes.title !== undefined) node.title = changes.title;
      if (changes.url !== undefined) node.url = changes.url;
      return { ...node };
    },
    remove: async () => {},
    removeTree: async (id: string) => {
      const p = tree.get(id);
      if (!p?.parentId) return;
      const parent = tree.get(p.parentId)!;
      parent.children = parent.children!.filter((c) => c.id !== id);
      tree.delete(id);
    },
    onCreated: { addListener: () => {} },
    onChanged: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  };
}

/** Firefox 157 实测的根形状（无 folderType / syncing）。 */
const makeFirefoxChrome = () =>
  makeMock('root________', [
    { id: 'menu________', title: '书签菜单' },
    { id: 'toolbar_____', title: '书签工具栏' },
    { id: 'unfiled_____', title: '其他书签' },
    { id: 'mobile______', title: '移动设备上的书签' },
  ]);

/** Edge：Chromium 单树（有 folderType，但无账号存储 → syncing:false）。 */
const makeEdgeChrome = () =>
  makeMock('0', [
    { id: '1', title: '收藏夹栏', folderType: 'bookmarks-bar', syncing: false },
    { id: '2', title: '其他收藏夹', folderType: 'other', syncing: false },
    { id: '3', title: '移动设备收藏夹', folderType: 'mobile', syncing: false },
  ]);

/** 从 mock 的真实 getTree() 解析根、按解析结果播种桥（锁住 resolver ↔ bridge 契约）。 */
async function bridgeFor(chrome: ChromeBookmarksAPI, isFirefox: boolean): Promise<IdBridge> {
  const { pairs } = resolveRoots(await chrome.getTree(), isFirefox);
  return new IdBridge(undefined, { roots: pairs });
}

async function titlesUnder(chrome: ChromeBookmarksAPI, parentId: string): Promise<string[]> {
  const tree = await chrome.getTree();
  const find = (ns: ChromeTreeNode[]): ChromeTreeNode | null => {
    for (const n of ns) {
      if (n.id === parentId) return n;
      const hit = find(n.children ?? []);
      if (hit) return hit;
    }
    return null;
  };
  return (find(tree)?.children ?? []).map((n) => n.title);
}

let transport: MemoryOpLogTransport;
let coordinator: SyncCoordinator;
let sharedKey: CryptoKey;

beforeEach(async () => {
  transport = new MemoryOpLogTransport();
  sharedKey = await generateKey();
  coordinator = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-x',
    transport,
    key: sharedKey,
  });
});

describe('跨浏览器落地：Firefox（无账号根）', () => {
  it('Chrome 账号子树内容 → 回退文件夹落在「其他书签」下，内容不丢、书签栏不被污染', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);

    // Firefox 没有账号根：账号 uuid 没有落地根
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBeNull();
    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBe('toolbar_____'); // 本地根在

    // 空间里有 Chrome 账号书签栏下的一条书签
    coordinator.createNodeWithId('acc-1', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '账号书签',
      url: 'https://acc.example',
    });

    await reverseApply(chrome, coordinator, bridge, { fallbackRootTitle: '同步恢复的书签' });

    // ① 根下仍是 4 个原生根，没有多出东西（不在根下 create）
    const root = (await chrome.getTree())[0];
    expect(root.children!.map((n) => n.id)).toEqual([
      'menu________',
      'toolbar_____',
      'unfiled_____',
      'mobile______',
    ]);
    // ② 整棵账号子树落到「其他书签」下的同名回退文件夹里
    const unfiled = root.children!.find((n) => n.id === 'unfiled_____')!;
    expect(unfiled.children!.map((n) => n.title)).toEqual(['账号书签栏']);
    expect(unfiled.children![0].children!.map((n) => n.title)).toEqual(['账号书签']);
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe(unfiled.children![0].id);
    // ③ 本地书签栏没被污染
    expect(await titlesUnder(chrome, 'toolbar_____')).toEqual([]);
    // ④ 空的账号根不建回退文件夹（避免凭空多出空文件夹）
    expect(await titlesUnder(chrome, 'unfiled_____')).toEqual(['账号书签栏']);
  });

  it('Firefox 原生菜单：MENU_UUID 内容落到 menu________，不在书签栏下建「书签菜单」容器', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);
    expect(bridge.toChromeId(MENU_UUID)).toBe('menu________');

    coordinator.createNodeWithId('menu-1', MENU_UUID, {
      title: '百度百科',
      url: 'https://baike.baidu.com',
    });

    await reverseApply(chrome, coordinator, bridge);

    expect(await titlesUnder(chrome, 'menu________')).toEqual(['百度百科']);
    expect(await titlesUnder(chrome, 'toolbar_____')).toEqual([]); // 没建容器
  });

  it('Firefox 移动书签根：MOBILE_UUID 内容落到 mobile______', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);
    expect(bridge.toChromeId(MOBILE_UUID)).toBe('mobile______');

    coordinator.createNodeWithId('mob-1', MOBILE_UUID, {
      title: '手机书签',
      url: 'https://mobile.example',
    });

    await reverseApply(chrome, coordinator, bridge);
    expect(await titlesUnder(chrome, 'mobile______')).toEqual(['手机书签']);
  });

  /**
   * 回归固化：回退文件夹**自身**不建节点，但子树被递归进它代表的落地根 uuid。
   * Firefox/Edge 上账号根永远不出现 → 回退文件夹是**永久**的，用户在里面新加
   * 的书签必须能同步出去（旧实现整棵跳过 → 静默不同步，退休时还会丢失）。
   */
  it('用户在「账号回退文件夹」里新加书签 → 被捕获到账号根下', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);

    // 1) 先让回退文件夹落地
    coordinator.createNodeWithId('acc-1', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '账号书签',
      url: 'https://acc.example',
    });
    await reverseApply(chrome, coordinator, bridge);
    const fbId = bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)!;
    expect(fbId).toBeTruthy();

    // 2) 用户在这个回退文件夹里新加一条书签
    const added = await chrome.create({
      parentId: fbId,
      title: '用户新加的',
      url: 'https://user-added.example',
    });

    // 3) 捕获轮：回退文件夹自身不建节点，子树递归到账号根 uuid → 新书签被捕获
    const captured = await captureLocalTree(chrome, coordinator, bridge, 'root________');
    expect(captured).toBe(1);
    const uuid = bridge.toUuid(added.id);
    expect(uuid).toBeTruthy();
    expect(coordinator.replica.getParent(uuid!)).toBe(ACCOUNT_BOOKMARKS_BAR_UUID);
  });
});

/** Firefox default-bookmarks.html 里的 4 条内置链接（含真实 UTM 参数）。 */
const FF_DEFAULT_URLS = [
  'https://support.mozilla.org/products/firefox',
  'https://support.mozilla.org/kb/customize-firefox-controls-buttons-and-toolbars?utm_source=firefox-browser&utm_medium=default-bookmarks&utm_campaign=customize',
  'https://www.mozilla.org/about/',
  'https://www.mozilla.org/contribute/',
];

describe('Firefox 内置默认书签：不入 CRDT', () => {
  /** 用真实 create 造出「其他书签」下的内置默认书签文件夹（模拟首次运行）。 */
  async function seedDefaultFolder(chrome: ChromeBookmarksAPI, parentId: string) {
    const folder = await chrome.create({ parentId, title: 'Mozilla Firefox' });
    for (const url of FF_DEFAULT_URLS) {
      await chrome.create({ parentId: folder.id, title: 'Firefox 链接', url });
    }
    return folder;
  }

  it('unfiled_____ 下的「Mozilla Firefox」文件夹整棵不被捕获', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);
    const folder = await seedDefaultFolder(chrome, 'unfiled_____');

    const captured = await captureLocalTree(chrome, coordinator, bridge, 'root________');
    expect(captured).toBe(0);
    expect(bridge.toUuid(folder.id)).toBeNull();
  });

  it('同名文件夹但含自定义 URL → 正常捕获（用户改过就别动）', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);
    const folder = await chrome.create({ parentId: 'unfiled_____', title: 'Mozilla Firefox' });
    await chrome.create({
      parentId: folder.id,
      title: '自定义',
      url: 'https://example.com/custom',
    });

    const captured = await captureLocalTree(chrome, coordinator, bridge, 'root________');
    expect(captured).toBe(2); // 文件夹 + 自定义书签
    expect(bridge.toUuid(folder.id)).toBeTruthy();
  });

  it('同名同 URL 但不在「其他书签」下 → 不误跳（父约束生效）', async () => {
    const chrome = makeFirefoxChrome();
    const bridge = await bridgeFor(chrome, true);
    const folder = await seedDefaultFolder(chrome, 'toolbar_____');

    const captured = await captureLocalTree(chrome, coordinator, bridge, 'root________');
    expect(captured).toBe(5); // 文件夹 + 4 链接都正常捕获
    expect(bridge.toUuid(folder.id)).toBeTruthy();
  });
});

describe('跨浏览器落地：Edge（Chromium 单树）', () => {
  it('Edge 形状（folderType + syncing:false）→ 本地根照常落地，账号 uuid 无落地根', async () => {
    const chrome = makeEdgeChrome();
    const bridge = await bridgeFor(chrome, false);

    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBe('1');
    expect(bridge.toChromeId(OTHER_BOOKMARKS_UUID)).toBe('2');
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBeNull(); // Edge 无账号存储

    // 来自 Firefox/Chrome 本地根的内容照常落到本地书签栏
    coordinator.createNodeWithId('loc-1', BOOKMARKS_BAR_UUID, {
      title: '本地书签',
      url: 'https://local.example',
    });
    await reverseApply(chrome, coordinator, bridge);
    expect(await titlesUnder(chrome, '1')).toEqual(['本地书签']);

    // 而账号子树内容只能走回退文件夹（和 Firefox 一样）
    coordinator.createNodeWithId('acc-2', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '账号书签',
      url: 'https://acc2.example',
    });
    await reverseApply(chrome, coordinator, bridge);
    expect(await titlesUnder(chrome, '2')).toEqual(['账号书签栏']);
  });
});

describe('跨浏览器落地：Chrome 侧的反向风险', () => {
  /**
   * 旧身份模型 / 单存储已登录的 Chrome：唯一一棵树的根都报 `syncing:true` →
   * `resolveRoots` 把它们归到**账号** uuid → 本地根（BOOKMARKS_BAR_UUID 等）在本机
   * 没有落地根。此时 Firefox/Edge 同步过来的**本地**书签无处落地。
   *
   * 正确行为 = 跳过 + 报给调用方（**不许**落到账号子树：会被上传 Google + 云端翻倍）。
   */
  it('Chrome 单树全 syncing:true → 本地根缺席，来自 Firefox 的本地内容只提示不静默', async () => {
    const chrome = makeMock('0', [
      { id: 'A', title: '书签栏', folderType: 'bookmarks-bar', syncing: true },
      { id: 'B', title: '其他书签', folderType: 'other', syncing: true },
    ]);
    const bridge = await bridgeFor(chrome, false);
    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBeNull(); // 本地根缺席
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('A');

    // Firefox 捕获的本地书签栏书签
    coordinator.createNodeWithId('ff-1', BOOKMARKS_BAR_UUID, {
      title: 'Firefox 的本地书签',
      url: 'https://ff.example',
    });

    const unplaceable: string[] = [];
    await reverseApply(chrome, coordinator, bridge, {
      fallbackRootTitle: '同步恢复的书签',
      onUnplaceableRoot: (u) => unplaceable.push(u),
    });

    // ① 没落到账号子树 ② 报给调用方（不静默）
    expect(await titlesUnder(chrome, 'A')).toEqual([]);
    expect(await titlesUnder(chrome, 'B')).toEqual([]);
    expect(unplaceable).toEqual([BOOKMARKS_BAR_UUID]);
  });
});

describe('CRDT 固定根契约（跨浏览器共用）', () => {
  it('ROOT 下恒为 7 个固定根（3 本地 + 1 菜单 + 3 账号），任何浏览器都一样', async () => {
    const underRoot = coordinator.replica
      .getVisibleTree()
      .filter((e) => e.parent === ROOT_UUID)
      .map((e) => e.child)
      .sort();
    expect(underRoot).toEqual(
      [
        BOOKMARKS_BAR_UUID,
        OTHER_BOOKMARKS_UUID,
        MOBILE_UUID,
        MENU_UUID,
        ACCOUNT_BOOKMARKS_BAR_UUID,
        ACCOUNT_OTHER_BOOKMARKS_UUID,
        ACCOUNT_MOBILE_UUID,
      ].sort(),
    );
  });
});
