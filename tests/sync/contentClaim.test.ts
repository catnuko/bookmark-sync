/**
 * tests/sync/contentClaim.test.ts — 「内容认领」轮（2026-10-01）。
 *
 * 覆盖两个已知缺陷：
 *   1. 跨设备翻倍：两台设备各自捕获同一账号子树 → 第二台应「认领」第一台的
 *      uuid（按内容指纹），而不是新建一份。
 *   2. 登录态切换重复：
 *      (a) IdBridge.load 保留陈旧回退映射 → 被真账号根覆盖的回归；
 *      (b) Chrome 从 Google 拉下来的账号子树被当「未映射」重复捕获 → 认领 +
 *          回退文件夹退休。
 * 以及保守边界：合法重复不误并、真新内容不误认领、退休不产生墓碑、
 * 不产生 parent=ROOT_UUID 的用户节点。
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  IdBridge,
  reverseApply,
  captureLocalTree,
  retireFallbackFolders,
  resolveRoots,
  contentKey,
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
  TRASH_NODE_ID,
} from '../../src/crdt/index.js';

const SPACE = 'cccccccc-0000-4000-8000-222222222222';

interface N extends ChromeTreeNode {
  parentId?: string;
  index?: number;
}

/**
 * 有状态 chrome.bookmarks mock：支持嵌套子树、动态 id 的账号根、回退文件夹，
 * 并忠实实现「根不可作父 / 永久节点不可改」与 `removeTree` 递归删除。
 */
function makeChrome(rootChildren: ChromeTreeNode[]): ChromeBookmarksAPI {
  const tree = new Map<string, N>();
  const seed = (n: N, parentId?: string): void => {
    if (parentId !== undefined && n.parentId === undefined) n.parentId = parentId;
    n.children ??= [];
    tree.set(n.id, n);
    for (const c of n.children) seed(c as N, n.id);
  };
  const ROOT_CHILDREN: N[] = [
    {
      id: '1',
      title: '书签栏',
      parentId: '0',
      index: 0,
      folderType: 'bookmarks-bar',
      syncing: false,
      children: [],
    },
    {
      id: '2',
      title: '其他书签',
      parentId: '0',
      index: 1,
      folderType: 'other',
      syncing: false,
      children: [],
    },
    {
      id: '3',
      title: '移动设备书签',
      parentId: '0',
      index: 2,
      folderType: 'mobile',
      syncing: false,
      children: [],
    },
    ...rootChildren.map((c, i) => ({ ...(c as N), parentId: '0', index: 3 + i })),
  ];
  const ROOTS: N[] = [{ id: '0', title: '', children: ROOT_CHILDREN }];
  for (const r of ROOTS) seed(r);
  let seq = 0;

  const MODIFY_ROOT = "Can't modify the root bookmark folders.";
  const PERMANENT = new Set(['0', '1', '2', '3']);
  const assertParent = (p: string): void => {
    if (p === '0') throw new Error(MODIFY_ROOT);
  };
  const assertNode = (id: string): void => {
    if (PERMANENT.has(id)) throw new Error(MODIFY_ROOT);
  };

  return {
    getTree: async () => {
      const clone = (n: N): N => ({ ...n, children: (n.children ?? []).map(clone) });
      return ROOTS.map(clone);
    },
    get: async (id) => {
      const ids = Array.isArray(id) ? id : [id];
      return ids
        .map((i) => tree.get(i))
        .filter((n): n is N => !!n)
        .map((n) => ({ ...n }) as ChromeTreeNode);
    },
    getChildren: async (parentId) => {
      const p = tree.get(parentId);
      return (p?.children ?? []).map((c) => ({ ...c }) as ChromeTreeNode);
    },
    create: async (props) => {
      assertParent(props.parentId);
      const id = 'n' + ++seq;
      const parent = tree.get(props.parentId)!;
      parent.children ??= [];
      const idx = Math.min(props.index ?? parent.children.length, parent.children.length);
      const node: N = {
        id,
        parentId: props.parentId,
        index: idx,
        title: props.title ?? '',
        url: props.url,
        children: [],
      };
      parent.children.splice(idx, 0, node);
      parent.children.forEach((c, i) => (c.index = i));
      tree.set(id, node);
      return { ...node } as ChromeTreeNode;
    },
    move: async (id, mp) => {
      assertNode(id);
      assertParent(mp.parentId);
      const node = tree.get(id)!;
      const old = tree.get(node.parentId!)!;
      old.children = (old.children ?? []).filter((c) => c.id !== id);
      node.parentId = mp.parentId;
      const np = tree.get(mp.parentId)!;
      np.children ??= [];
      const idx = Math.min(mp.index ?? np.children.length, np.children.length);
      np.children.splice(idx, 0, node);
      np.children.forEach((c, i) => (c.index = i));
      return { ...node } as ChromeTreeNode;
    },
    update: async (id, ch) => {
      assertNode(id);
      const node = tree.get(id)!;
      if (ch.title !== undefined) node.title = ch.title;
      if (ch.url !== undefined) node.url = ch.url;
      return { ...node } as ChromeTreeNode;
    },
    remove: async () => {},
    removeTree: async (id) => {
      const p = tree.get(id);
      if (!p?.parentId) return;
      const parent = tree.get(p.parentId)!;
      parent.children = (parent.children ?? []).filter((c) => c.id !== id);
      const drop = (n: N): void => {
        tree.delete(n.id);
        for (const c of n.children ?? []) drop(c as N);
      };
      drop(p);
    },
    onCreated: { addListener: () => {} },
    onChanged: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  };
}

/** 造一个「账号书签栏」根子节点（Chrome 双子树：folderType + syncing=true）。 */
const accountBar = (id: string, children: ChromeTreeNode[]): ChromeTreeNode => ({
  id,
  title: '账号书签栏',
  folderType: 'bookmarks-bar',
  syncing: true,
  children,
});

/** 用 resolveRoots 解析出的根集合建桥（模拟 sync.js 的 ensureActiveBridge）。 */
async function bridgeFor(chrome: ChromeBookmarksAPI): Promise<IdBridge> {
  const res = resolveRoots(await chrome.getTree(), false);
  return new IdBridge(undefined, { roots: res.pairs });
}

const newCoord = async (deviceId: string, transport = new MemoryOpLogTransport()) =>
  new SyncCoordinator({ spaceId: SPACE, deviceId, transport, key: await generateKey() });

describe('contentKey（跨设备一致的内容指纹）', () => {
  it('同父同类型同标题同 URL → 同键；换父 / 换类型 / 换 URL → 不同键', () => {
    const k = contentKey(ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });
    expect(contentKey(ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' })).toBe(k);
    expect(contentKey(BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' })).not.toBe(k);
    expect(contentKey(ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A' })).not.toBe(k); // 文件夹
    expect(contentKey(ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://b' })).not.toBe(k);
  });

  it('字段分隔不碰撞（顺序无关）', () => {
    expect(contentKey('p', { title: 'ab', url: 'c' })).not.toBe(
      contentKey('p', { title: 'a', url: 'bc' }),
    );
  });
});

describe('IdBridge.load：本轮 seed 才是落地根权威', () => {
  it('陈旧回退映射不得覆盖真账号根（defect 2a 回归）', () => {
    const bridge = new IdBridge(undefined, {
      roots: [
        ['0', ROOT_UUID],
        ['5', ACCOUNT_BOOKMARKS_BAR_UUID],
      ],
    });
    // 持久化里同时有「登出期占位文件夹 100」与「真根 5」两条 → 真根胜出
    bridge.load({ '100': ACCOUNT_BOOKMARKS_BAR_UUID, '5': ACCOUNT_BOOKMARKS_BAR_UUID });
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('5');
    expect(bridge.toUuid('100')).toBeNull();
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('100'); // 记为回退待退休
  });

  it('未 seed 的落地根持久化映射保留为回退（迁移安全：不重复建回退文件夹）', () => {
    const bridge = new IdBridge(undefined, { roots: [['0', ROOT_UUID]] });
    bridge.load({ '5': ACCOUNT_BOOKMARKS_BAR_UUID });
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('5'); // 保留，不丢弃
    expect(bridge.toUuid('5')).toBe(ACCOUNT_BOOKMARKS_BAR_UUID);
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('5'); // 记为回退
  });

  it('MENU 的动态持久化映射仍然保留（Chromium 书签菜单容器）', () => {
    const bridge = new IdBridge(undefined, { roots: [['0', ROOT_UUID]] });
    bridge.load({ m1: MENU_UUID });
    expect(bridge.toChromeId(MENU_UUID)).toBe('m1');
  });
});

describe('内容认领：跨设备翻倍', () => {
  it('第二台设备 pull 后捕获同一账号子树 → 认领第一台的 uuid，零新建', async () => {
    const transport = new MemoryOpLogTransport();
    const key = await generateKey();
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-a', transport, key });

    const chromeA = makeChrome([
      accountBar('5', [
        { id: 'x', title: 'A', url: 'https://a' },
        { id: 'y', title: 'B', url: 'https://b' },
      ]),
    ]);
    const bridgeA = await bridgeFor(chromeA);
    const nA = await captureLocalTree(chromeA, A, bridgeA, '0');
    await A.flushPush();
    expect(nA).toBe(2);
    const uX = bridgeA.toUuid('x')!;
    const uY = bridgeA.toUuid('y')!;

    // B 先 pull（拿到 A 的节点），再用**不同的 chromeId** 捕获同一内容
    const B = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-b', transport, key });
    await B.pull();
    const chromeB = makeChrome([
      accountBar('5', [
        { id: 'p', title: 'A', url: 'https://a' },
        { id: 'q', title: 'B', url: 'https://b' },
      ]),
    ]);
    const bridgeB = await bridgeFor(chromeB);
    const nB = await captureLocalTree(chromeB, B, bridgeB, '0');

    expect(nB).toBe(0); // 全部认领，无新建
    expect(bridgeB.toUuid('p')).toBe(uX);
    expect(bridgeB.toUuid('q')).toBe(uY);
    expect(B.replica.getChildren(ACCOUNT_BOOKMARKS_BAR_UUID).length).toBe(2); // 没翻倍
  });
});

describe('内容认领：登录态切换重复', () => {
  it('回退文件夹 + 真账号根并存 → 零新建、回退退休、1:1 保持、无墓碑', async () => {
    const coord = await newCoord('dev-me');
    const U1 = '11111111-0000-4000-8000-000000000001';
    const U2 = '11111111-0000-4000-8000-000000000002';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });
    coord.createNodeWithId(U2, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'B', url: 'https://b' });

    // chrome：真账号根 "5"（Chrome 从 Google 拉的，未映射）+ 「其他书签」下的回退文件夹
    const chrome = makeChrome([
      accountBar('5', [
        { id: '10', title: 'A', url: 'https://a' },
        { id: '11', title: 'B', url: 'https://b' },
      ]),
    ]);
    const F = await chrome.create({ parentId: '2', title: '账号书签栏' });
    const f1 = await chrome.create({ parentId: F.id, title: 'A', url: 'https://a' });
    const f2 = await chrome.create({ parentId: F.id, title: 'B', url: 'https://b' });

    const bridge = await bridgeFor(chrome);
    bridge.loadFallbacks({ [ACCOUNT_BOOKMARKS_BAR_UUID]: F.id });
    bridge.map(f1.id, U1); // 回退侧旧映射
    bridge.map(f2.id, U2);

    // 捕获：真根 "5" 的子节点认领 U1/U2（从回退侧抢绑），不新建
    const captured = await captureLocalTree(chrome, coord, bridge, '0');
    expect(captured).toBe(0);
    expect(bridge.toUuid('10')).toBe(U1);
    expect(bridge.toUuid('11')).toBe(U2);
    expect(bridge.toUuid(f1.id)).toBeNull(); // 旧映射已被抢走

    // 退休回退文件夹（先丢映射再删 → 不产生墓碑）
    const retired = await retireFallbackFolders(chrome, bridge);
    expect(retired).toBe(1);
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBeNull();
    const treeAfter = await chrome.getTree();
    const other = treeAfter[0].children!.find((n) => n.id === '2')!;
    expect(other.children!.some((n) => n.title === '账号书签栏')).toBe(false); // 回退已删

    // 反向应用：不报错、真根下恰好 2 条、无墓碑、硬约束成立
    await reverseApply(chrome, coord, bridge);
    const accountRoot = (await chrome.getTree())[0].children!.find((n) => n.id === '5')!;
    expect(accountRoot.children!.length).toBe(2);
    expect(coord.replica.getChildren(TRASH_NODE_ID).length).toBe(0); // 退休未产生墓碑
    // 硬约束：ROOT_UUID 下只挂 7 个固定根（8 根含 ROOT 自身），无用户节点
    const rootKids = coord.replica.getChildren(ROOT_UUID).map((c) => c.id);
    expect(rootKids.length).toBe(7);
    expect(rootKids).not.toContain(U1);
    expect(rootKids).not.toContain(U2);
  });

  it('退休不丢内容：真根里还没有的 CRDT 节点由 reverseApply 重新落地', async () => {
    const coord = await newCoord('dev-partial');
    const U1 = '55555555-0000-4000-8000-000000000001';
    const U2 = '55555555-0000-4000-8000-000000000002';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });
    coord.createNodeWithId(U2, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'B', url: 'https://b' });

    // 真账号根只拉到 A（B 还没同步下来）；回退文件夹里有 A、B 两份
    const chrome = makeChrome([accountBar('5', [{ id: '10', title: 'A', url: 'https://a' }])]);
    const F = await chrome.create({ parentId: '2', title: '账号书签栏' });
    const f1 = await chrome.create({ parentId: F.id, title: 'A', url: 'https://a' });
    const f2 = await chrome.create({ parentId: F.id, title: 'B', url: 'https://b' });

    const bridge = await bridgeFor(chrome);
    bridge.loadFallbacks({ [ACCOUNT_BOOKMARKS_BAR_UUID]: F.id });
    bridge.map(f1.id, U1);
    bridge.map(f2.id, U2);

    expect(await captureLocalTree(chrome, coord, bridge, '0')).toBe(0);
    expect(bridge.toUuid('10')).toBe(U1);
    await retireFallbackFolders(chrome, bridge);
    await reverseApply(chrome, coord, bridge);

    const accountRoot = (await chrome.getTree())[0].children!.find((n) => n.id === '5')!;
    expect(accountRoot.children!.map((c) => c.title).sort()).toEqual(['A', 'B']); // B 重新落地，没丢
    expect(coord.replica.getChildren(ACCOUNT_BOOKMARKS_BAR_UUID).length).toBe(2);
  });

  it('仍由回退代表的根（真根未出现）→ 不退休', async () => {
    const chrome = makeChrome([]); // 无账号根
    const F = await chrome.create({ parentId: '2', title: '账号书签栏' });
    const bridge = await bridgeFor(chrome);
    bridge.loadFallbacks({ [ACCOUNT_BOOKMARKS_BAR_UUID]: F.id });
    bridge.map(F.id, ACCOUNT_BOOKMARKS_BAR_UUID); // 回退代表该根
    expect(await retireFallbackFolders(chrome, bridge)).toBe(0);
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe(F.id);
  });
});

describe('内容认领：迁移与自愈', () => {
  it('已识别的回退文件夹不被重新捕获（旧版无回退记录时也不翻倍）', async () => {
    const coord = await newCoord('dev-migrate');
    const U1 = '66666666-0000-4000-8000-000000000001';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });

    const chrome = makeChrome([]); // 无账号根（登出）
    const F = await chrome.create({ parentId: '2', title: '账号书签栏' }); // 旧版建的回退
    const f1 = await chrome.create({ parentId: F.id, title: 'A', url: 'https://a' });
    const bridge = await bridgeFor(chrome);
    bridge.load({ [F.id]: ACCOUNT_BOOKMARKS_BAR_UUID }); // 旧版持久化：回退文件夹 → 账号根
    bridge.map(f1.id, U1);

    const captured = await captureLocalTree(chrome, coord, bridge, '0');
    expect(captured).toBe(0); // 回退文件夹被识别 → 不新建
    expect(bridge.toUuid(F.id)).toBe(ACCOUNT_BOOKMARKS_BAR_UUID); // 仍代表账号根
    expect(bridge.toUuid(f1.id)).toBe(U1);
    expect(coord.replica.getChildren(OTHER_BOOKMARKS_UUID).length).toBe(0); // 没多出空文件夹节点
  });

  it('落地根映射指向已不存在的节点 → reverseApply 重新落地（自愈）', async () => {
    const coord = await newCoord('dev-dead');
    const U1 = '77777777-0000-4000-8000-000000000001';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });

    const chrome = makeChrome([]); // 无账号根、无回退
    const bridge = await bridgeFor(chrome);
    bridge.map('999', ACCOUNT_BOOKMARKS_BAR_UUID); // 死映射：999 不存在

    await reverseApply(chrome, coord, bridge);
    const two = (await chrome.getTree())[0].children!.find((n) => n.id === '2')!;
    const fb = two.children!.find((n) => n.title === '账号书签栏')!;
    expect(fb).toBeTruthy();
    expect(fb.children!.map((c) => c.title)).toEqual(['A']); // 内容重新落地
    expect(bridge.fallbackFor(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe(fb.id); // 记录更新为新回退
  });
});

describe('内容认领：保守边界', () => {
  it('合法重复不误并：同父同内容两条 → 各占一个候选', async () => {
    const coord = await newCoord('dev-dup');
    const U1 = '22222222-0000-4000-8000-000000000001';
    const U2 = '22222222-0000-4000-8000-000000000002';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: 'GitHub',
      url: 'https://github.com',
    });
    coord.createNodeWithId(U2, ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: 'GitHub',
      url: 'https://github.com',
    });

    const chrome = makeChrome([
      accountBar('5', [
        { id: '10', title: 'GitHub', url: 'https://github.com' },
        { id: '11', title: 'GitHub', url: 'https://github.com' },
      ]),
    ]);
    const bridge = await bridgeFor(chrome);
    const captured = await captureLocalTree(chrome, coord, bridge, '0');

    expect(captured).toBe(0);
    const mapped = [bridge.toUuid('10'), bridge.toUuid('11')];
    expect(new Set(mapped).size).toBe(2); // 两个不同 uuid
    expect([...mapped].sort()).toEqual([U1, U2]);
  });

  it('真新内容不误认领：无同内容候选 → 正常新建', async () => {
    const coord = await newCoord('dev-new');
    const U1 = '33333333-0000-4000-8000-000000000001';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });

    const chrome = makeChrome([
      accountBar('5', [
        { id: '10', title: 'A', url: 'https://a' },
        { id: '11', title: 'Z', url: 'https://z' },
      ]),
    ]);
    const bridge = await bridgeFor(chrome);
    const captured = await captureLocalTree(chrome, coord, bridge, '0');

    expect(captured).toBe(1);
    expect(bridge.toUuid('10')).toBe(U1); // 认领
    expect(bridge.toUuid('11')).not.toBeNull(); // 新建
    expect(bridge.toUuid('11')).not.toBe(U1);
  });

  it('本机已映射到真实节点的 uuid 不被认领（保守面）', async () => {
    const coord = await newCoord('dev-taken');
    const U1 = '44444444-0000-4000-8000-000000000001';
    coord.createNodeWithId(U1, ACCOUNT_BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });

    // chrome 里 U1 已由书签栏下的一条真实节点占据；账号根下又出现同内容
    const chrome = makeChrome([accountBar('5', [{ id: '10', title: 'A', url: 'https://a' }])]);
    const real = await chrome.create({ parentId: '1', title: 'A', url: 'https://a' });
    const bridge = await bridgeFor(chrome);
    bridge.map(real.id, U1); // 本机真实节点已占用 U1

    const captured = await captureLocalTree(chrome, coord, bridge, '0');
    expect(captured).toBe(1); // 不抢本机真实节点的 uuid → 新建
    expect(bridge.toUuid(real.id)).toBe(U1);
    expect(bridge.toUuid('10')).not.toBe(U1);
  });
});
