/**
 * tests/sync/reverseApply.test.ts — 远端 CRDT 状态 → chrome.bookmarks 写回。
 *
 * Covers the reverse direction of the sync loop: after pulling remote ops,
 * the merged CRDT tree must be materialised onto the local chrome tree
 * (create / move / update / remove), and the event guard must prevent echo.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  IdBridge,
  reverseApply,
  captureLocalTree,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_NODE_ID,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
  TRASH_NODE_ID,
} from '../../src/crdt/index.js';

const SPACE = 'bbbbbbbb-0000-4000-8000-111111111111';

/**
 * A stateful chrome.bookmarks mock: create/move/update/remove mutate an
 * in-memory tree so reverseApply's reconciliation can be asserted.
 *
 * ⚠ `create` 必须**忠实实现 `index` 语义**（插到该位次，不是无脑 push）：
 * 真实 Chrome 会按 index 插入，而 reverseApply 的整层顺序完全依赖它。早期
 * 这份 mock 直接 `children.push(node)` 忽略 index，于是「空父节点下批量创建
 * 会整体倒序」这个 bug 在单测里永远测不出来（2026-09-22 用户实测踩到）。
 *
 * ⚠ **根保护也必须忠实实现**：Chrome 的 `CanBeModified()` 只对
 * `node->is_root()` 返回 false，任何以根（"0"）为父的 create/move，或对永久
 * 节点（根/书签栏/其他书签/移动设备）的 move/update，都返回
 * `kModifySpecialError` = "Can't modify the root bookmark folders."
 * （`chrome/browser/extensions/api/bookmarks_core/bookmarks_function.cc`）。
 * 早期 mock 允许往 "0" 下 create，于是「CRDT 里有 parent=ROOT_UUID 的节点」
 * 这条线上事故（2026-10-01）在单测里同样测不出来。
 */
function makeChrome(extraRootChildren: ChromeTreeNode[] = []) {
  interface N extends ChromeTreeNode {
    parentId?: string;
    index?: number;
    url?: string;
  }
  const tree = new Map<string, N>();
  const seed = (n: N) => {
    tree.set(n.id, n);
    for (const c of n.children ?? []) seed(c);
  };
  const ROOT_CHILDREN: N[] = [
    { id: '1', title: '书签栏', parentId: '0', index: 0, children: [] },
    { id: '2', title: '其他书签', parentId: '0', index: 1, children: [] },
    { id: '3', title: '移动设备书签', parentId: '0', index: 2, children: [] },
    // 浏览器根下的**额外**子节点：Chrome 的账号书签 / 受管书签永久文件夹
    // （`BookmarkModel::CreateAccountPermanentFolders` 把它们 AddNode 到 root 上，
    // 非空即可见并出现在 getTree() 里）。id 是动态分配的，不在固定根表内。
    ...extraRootChildren.map((c, i) => ({ ...c, parentId: '0', index: 3 + i })),
  ];
  const ROOTS: N[] = [{ id: '0', title: '', children: ROOT_CHILDREN }];
  for (const r of ROOTS) seed(r);
  let seq = 0;

  /** Chrome 的 `is_root()`：只有 "0" 不可作父、不可改。 */
  const ROOT_ID = '0';
  /** Chrome 的 `is_permanent_node()`：根 + 三个固定根文件夹。 */
  const PERMANENT = new Set(['0', '1', '2', '3']);
  const MODIFY_ROOT_ERROR = "Can't modify the root bookmark folders.";
  const assertParentModifiable = (parentId: string) => {
    if (parentId === ROOT_ID) throw new Error(MODIFY_ROOT_ERROR);
  };
  const assertNodeModifiable = (id: string) => {
    if (PERMANENT.has(id)) throw new Error(MODIFY_ROOT_ERROR);
  };

  const api: ChromeBookmarksAPI = {
    getTree: async () => {
      const clone = (n: N): N => ({ ...n, children: (n.children ?? []).map(clone) });
      return ROOTS.map(clone);
    },
    get: async () => [],
    getChildren: async (parentId: string) => {
      const p = tree.get(parentId);
      return (p?.children ?? []).map((c) => ({ ...c }));
    },
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
      kids.splice(idx, 0, node); // ← 按 index 插入（不是 push）
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
  return api;
}

let chrome: ChromeBookmarksAPI;
let transport: MemoryOpLogTransport;
let coordinator: SyncCoordinator;
let sharedKey: CryptoKey;

beforeEach(async () => {
  chrome = makeChrome();
  transport = new MemoryOpLogTransport();
  sharedKey = await generateKey(); // E2EE：所有设备共享同一把密钥
  coordinator = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-rev',
    transport,
    key: sharedKey,
  });
});

/**
 * Simulate a remote device that created a bookmark and pushed it here.
 * deviceId 'zzz-…' ensures that, in the rare same-counter tie-break,
 * the REMOTE op wins (real devices have independent counters, so this is
 * only exercising a deterministic ordering, not a real-world case).
 */
async function receiveRemote(deviceId: string, push: (c: SyncCoordinator) => void) {
  const remote = new SyncCoordinator({
    spaceId: SPACE,
    deviceId,
    transport,
    key: sharedKey,
  });
  push(remote);
  await remote.flushPush();
  // Pull them into the local coordinator (as runSync does).
  await coordinator.pull();
}

describe('reverseApply (远端 → 本机 chrome 写回)', () => {
  it('creates remote bookmarks under the mapped parent with title/url', async () => {
    await receiveRemote('zzz-remote', (c) => {
      c.createNodeWithId('uu-1', BOOKMARKS_BAR_UUID, {
        title: '远端书签',
        url: 'https://remote.example',
      });
    });

    const bridge = new IdBridge();
    await reverseApply(chrome, coordinator, bridge);

    const tree = await chrome.getTree();
    const bar = tree[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.length).toBe(1);
    expect(bar.children![0].title).toBe('远端书签');
    expect(bar.children![0].url).toBe('https://remote.example');
    // mapping persisted: chromeId -> uuid
    expect(bridge.toUuid(bar.children![0].id)).toBe('uu-1');
  });

  it('moves a node to a new parent as the CRDT tree dictates', async () => {
    // Local chrome already has the node under bar; remote moved it under "2".
    const local = coordinator;
    local.createNodeWithId('uu-m', BOOKMARKS_BAR_UUID, { title: 'm' });
    const bridge = new IdBridge();
    const cm1 = await chrome.create({ parentId: '1', title: 'm' }); // chrome node exists
    bridge.map(cm1.id, 'uu-m');

    await receiveRemote('zzz-remote', (c) => {
      c.moveNode('uu-m', OTHER_BOOKMARKS_UUID, { title: 'm' });
    });

    await reverseApply(chrome, coordinator, bridge);
    const tree = await chrome.getTree();
    const other = tree[0].children!.find((n) => n.id === '2')!;
    expect(other.children!.some((n) => n.id === cm1.id)).toBe(true);
  });

  it('updates title/url for an existing chrome node', async () => {
    const bridge = new IdBridge();
    const chromeNode = await chrome.create({ parentId: '1', title: '旧标题', url: 'https://old' });
    bridge.map(chromeNode.id, 'uu-u');
    await coordinator.createNodeWithId('uu-u', BOOKMARKS_BAR_UUID, {
      title: '旧标题',
      url: 'https://old',
    });

    await receiveRemote('zzz-remote', (c) => {
      c.moveNode('uu-u', BOOKMARKS_BAR_UUID, { title: '新标题', url: 'https://new' });
    });

    await reverseApply(chrome, coordinator, bridge);
    const [updated] = await chrome.getChildren('1');
    expect(updated.title).toBe('新标题');
    expect(updated.url).toBe('https://new');
  });

  it('removes nodes that became unreachable (trashed remotely)', async () => {
    const bridge = new IdBridge();
    const chromeNode = await chrome.create({ parentId: '1', title: '要被删', url: 'https://x' });
    bridge.map(chromeNode.id, 'uu-d');
    await coordinator.createNodeWithId('uu-d', BOOKMARKS_BAR_UUID, {
      title: '要被删',
      url: 'https://x',
    });

    await receiveRemote('zzz-remote', (c) => {
      c.deleteNode('uu-d');
    });

    await reverseApply(chrome, coordinator, bridge);
    const bar = (await chrome.getTree())[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.length).toBe(0); // 远端删除 → 本机删除
  });

  it('leaves unmapped chrome nodes alone (no data loss for non-extension bookmarks)', async () => {
    const bridge = new IdBridge();
    await chrome.create({ parentId: '1', title: '原生书签', url: 'https://native' }); // no mapping
    await receiveRemote('zzz-remote', (c) => {
      c.createNodeWithId('uu-x', BOOKMARKS_BAR_UUID, { title: '远端' });
    });
    await reverseApply(chrome, coordinator, bridge);
    const bar = (await chrome.getTree())[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.some((n) => n.title === '原生书签')).toBe(true);
    expect(bar.children!.some((n) => n.title === '远端')).toBe(true);
  });

  it('菜单内容被 tombstone 后，reverseApply 保留本机容器、删除菜单内书签（内容不复活）', async () => {
    const bridge = new IdBridge();
    // 本机书签栏下有「书签菜单」容器（映射 MENU_UUID）+ 菜单内书签
    const menuNode = await chrome.create({ parentId: '1', title: '书签菜单' });
    bridge.map(menuNode.id, MENU_UUID);
    const menuChild = await chrome.create({
      parentId: menuNode.id,
      title: '百度百科',
      url: 'https://baike.baidu.com',
    });
    bridge.map(menuChild.id, 'uu-menu-child');
    await coordinator.createNodeWithId('uu-menu-child', MENU_UUID, {
      title: '百度百科',
      url: 'https://baike.baidu.com',
    });

    // 远端删除了菜单里的书签（tombstone 内容，菜单位置保留）
    await receiveRemote('zzz-remote', (c) => {
      c.deleteNode('uu-menu-child');
    });

    await reverseApply(chrome, coordinator, bridge);
    const bar = (await chrome.getTree())[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.some((n) => n.id === menuNode.id)).toBe(true); // 容器保留（位置不可删）
    const menu = bar.children!.find((n) => n.id === menuNode.id)!;
    expect(menu.children!.some((n) => n.id === menuChild.id)).toBe(false); // 内容不复活
  });

  it("映射残留但 Chrome 节点已消失（级联删除）→ 重新 create 而非 move（不抛 Can't find bookmark）", async () => {
    const bridge = new IdBridge();
    // bridge 里残留 ghost-id → uu-g，但 Chrome 中该节点已被（级联）删除
    bridge.map('ghost-id', 'uu-g');
    await coordinator.createNodeWithId('uu-g', BOOKMARKS_BAR_UUID, {
      title: '复活',
      url: 'https://revive',
    });

    await expect(reverseApply(chrome, coordinator, bridge)).resolves.toBeUndefined();
    const bar = (await chrome.getTree())[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.length).toBe(1); // 重新创建而非报错
    expect(bar.children![0].title).toBe('复活');
    expect(bridge.toUuid(bar.children![0].id)).toBe('uu-g'); // 映射更新到新 chromeId
  });

  /**
   * 线上事故回归（2026-10-01，app_version=2.7.0 / Chrome 154）：
   * 老版本 captureLocalTree 会把浏览器根下的**非原生根**子节点也捕获进 CRDT
   * （Chrome 账号书签 / 受管书签永久文件夹、Firefox tags________），生成
   * parent=ROOT_UUID 的 op。op 日志 append-only → 永久留在云端 → 之后每台**新
   * 设备**投影时都会在根下 create，Chrome 返回 kModifySpecialError：
   *   "Can't modify the root bookmark folders."
   * 触发它的 profile（捕获方）反而正常：节点已存在且已映射，走不到 create。
   * 症状 = 「新建 profile → 选默认空间 → 同步失败」。
   */
  it('CRDT 里 parent=ROOT_UUID 的节点（历史脏数据）不再让同步崩掉，且根下不建任何东西', async () => {
    // 模拟旧版本捕获出来的脏节点：直接挂在 ROOT_UUID 下
    await coordinator.createNodeWithId('uu-account-other', ROOT_UUID, { title: 'Other bookmarks' });
    await coordinator.createNodeWithId('uu-account-child', 'uu-account-other', {
      title: '账号书签',
      url: 'https://account.example',
    });

    await expect(reverseApply(chrome, coordinator, new IdBridge())).resolves.toBeUndefined();

    // 根（"0"）下仍只有三个固定根文件夹，没被塞进任何东西
    const root = (await chrome.getTree())[0];
    expect(root.children!.map((n) => n.id)).toEqual(['1', '2', '3']);
  });

  it('captureLocalTree 不捕获浏览器根下的非原生根子节点（账号书签 / 受管书签 / Firefox tags）', async () => {
    // getTree 里根下多出一个动态 id 的永久文件夹（非空 → 可见）
    const chromeWithAccountRoot = makeChrome([
      {
        id: '4',
        title: 'Other bookmarks',
        children: [{ id: '4-1', title: '账号书签', url: 'https://account.example' }],
      },
    ]);
    const bridge = new IdBridge();
    const captured = await captureLocalTree(chromeWithAccountRoot, coordinator, bridge, '0');

    expect(captured).toBe(0); // 整棵子树跳过
    expect(bridge.toUuid('4')).toBeNull();
    expect(bridge.toUuid('4-1')).toBeNull();
    // CRDT 里不得出现任何 parent=ROOT_UUID 的用户节点（脏 op 的源头）
    const underRoot = coordinator.replica
      .getVisibleTree()
      .filter((e) => e.parent === ROOT_UUID)
      .map((e) => e.child)
      .sort();
    expect(underRoot).toEqual(
      [BOOKMARKS_BAR_UUID, OTHER_BOOKMARKS_UUID, MOBILE_UUID, MENU_UUID].sort(),
    );
  });
});

/** 读出某父下的子节点标题（按 chrome 当前顺序）。 */
async function titlesUnder(parentId: string): Promise<string[]> {
  const tree = await chrome.getTree();
  const find = (ns: ChromeTreeNode[]): ChromeTreeNode | null => {
    for (const n of ns) {
      if (n.id === parentId) return n;
      const hit = find(n.children ?? []);
      if (hit) return hit;
    }
    return null;
  };
  const hit = find(tree);
  return (hit?.children ?? []).map((n) => n.title);
}

/**
 * 兄弟顺序（meta.position → chrome index）。
 *
 * 回归来源（2026-09-22 用户实测）：**新设备首次同步后整层顺序倒序，第二次同步
 * 又自己修好**。根因在 ensureReachableNodes 的 siblingsOf：空父节点（新设备上
 * 还没内容的书签栏、本轮刚 create 的文件夹）拿到一次性数组，index 全算成 0 →
 * 每个子节点都以 index:0 创建 → 倒序；第二轮节点已存在走 move 对齐分支才纠正。
 *
 * ⚠ 这些用例只在 mock **忠实实现 create 的 index** 时有效（见 makeChrome 注释）。
 */
describe('兄弟顺序（position → chrome index）', () => {
  it('空父节点下批量创建：第一遍落地就按 position 排好（回归：曾整体倒序）', async () => {
    // 远端已算好 position 的形状：书签在最前，两个文件夹跟在后面。
    coordinator.createNodeWithId('p-b', BOOKMARKS_BAR_UUID, {
      title: '书签',
      url: 'https://b',
      position: 'V',
    });
    coordinator.createNodeWithId('p-f1', BOOKMARKS_BAR_UUID, { title: '文件夹1', position: 'n' });
    coordinator.createNodeWithId('p-f2', BOOKMARKS_BAR_UUID, { title: '文件夹2', position: 'x' });

    await reverseApply(chrome, coordinator, new IdBridge());

    expect(await titlesUnder('1')).toEqual(['书签', '文件夹1', '文件夹2']);
  });

  it('本轮新建的文件夹：其子节点顺序也正确（同一处空父路径）', async () => {
    coordinator.createNodeWithId('p-folder', BOOKMARKS_BAR_UUID, {
      title: '文件夹',
      position: 'V',
    });
    for (const [uuid, title, pos] of [
      ['p-c1', 'c1', 'V'],
      ['p-c2', 'c2', 'n'],
      ['p-c3', 'c3', 'x'],
    ] as const) {
      coordinator.createNodeWithId(uuid, 'p-folder', {
        title,
        url: `https://${title}`,
        position: pos,
      });
    }

    const bridge = new IdBridge();
    await reverseApply(chrome, coordinator, bridge);

    expect(await titlesUnder('1')).toEqual(['文件夹']);
    const folderChromeId = bridge.toChromeId('p-folder')!;
    expect(await titlesUnder(folderChromeId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('幂等：第二遍 reverseApply 不改变顺序', async () => {
    for (const [uuid, title, pos] of [
      ['p-1', 'a', 'V'],
      ['p-2', 'b', 'n'],
      ['p-3', 'c', 'x'],
    ] as const) {
      coordinator.createNodeWithId(uuid, BOOKMARKS_BAR_UUID, { title, position: pos });
    }
    const bridge = new IdBridge();
    await reverseApply(chrome, coordinator, bridge);
    expect(await titlesUnder('1')).toEqual(['a', 'b', 'c']);

    await reverseApply(chrome, coordinator, bridge);
    expect(await titlesUnder('1')).toEqual(['a', 'b', 'c']);
  });

  it('远端改序后重跑：move 到新位次', async () => {
    for (const [uuid, title, pos] of [
      ['p-1', 'a', 'V'],
      ['p-2', 'b', 'n'],
      ['p-3', 'c', 'x'],
    ] as const) {
      coordinator.createNodeWithId(uuid, BOOKMARKS_BAR_UUID, { title, position: pos });
    }
    const bridge = new IdBridge();
    await reverseApply(chrome, coordinator, bridge);

    // 远端把 a 挪到末尾（position 变大）
    coordinator.moveNode('p-1', BOOKMARKS_BAR_UUID, { title: 'a', position: 'zz' });
    await reverseApply(chrome, coordinator, bridge);

    expect(await titlesUnder('1')).toEqual(['b', 'c', 'a']);
  });

  it('父节点已有未映射的原生书签：扩展节点按 position 落位，原生节点被推向后方', async () => {
    await chrome.create({ parentId: '1', title: '原生书签', url: 'https://native' });
    coordinator.createNodeWithId('p-b', BOOKMARKS_BAR_UUID, {
      title: '书签',
      url: 'https://b',
      position: 'V',
    });
    coordinator.createNodeWithId('p-f1', BOOKMARKS_BAR_UUID, { title: '文件夹1', position: 'n' });

    await reverseApply(chrome, coordinator, new IdBridge());

    expect(await titlesUnder('1')).toEqual(['书签', '文件夹1', '原生书签']);
  });
});

describe('双向同步闭环（两设备经共享 transport）', () => {
  it('device A creates, device B syncs: op flows A→server→B→chrome', async () => {
    const devB = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'dev-B',
      transport,
      key: sharedKey,
    });

    // A creates & pushes.
    await receiveRemote('zzz-A', (c) => {
      c.createNodeWithId('uu-ab', BOOKMARKS_BAR_UUID, { title: '从A到B', url: 'https://ab' });
    });
    // B pulls + reverse-applies to its own chrome.
    await devB.pull();
    await reverseApply(chrome, devB, new IdBridge());
    const bar = (await chrome.getTree())[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.some((n) => n.title === '从A到B')).toBe(true);
  });

  it('B locally creates after pulling: both devices converge to same tree', async () => {
    const devB = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'dev-B',
      transport,
      key: sharedKey,
    });

    await receiveRemote('zzz-A', (c) => {
      c.createNodeWithId('uu-1', BOOKMARKS_BAR_UUID, { title: 'A 的书签' });
    });
    await devB.pull();
    await devB.flushPush();
    devB.createNodeWithId('uu-2', BOOKMARKS_BAR_UUID, { title: 'B 的书签' });
    await devB.flushPush();

    await coordinator.pull();
    await coordinator.flushPush();

    const treeA = coordinator.replica
      .getVisibleTree()
      .map((e) => e.child)
      .sort();
    const treeB = devB.replica
      .getVisibleTree()
      .map((e) => e.child)
      .sort();
    expect(treeA).toEqual(treeB);
    expect(treeA).toContain('uu-1');
    expect(treeA).toContain('uu-2');
  });
});
