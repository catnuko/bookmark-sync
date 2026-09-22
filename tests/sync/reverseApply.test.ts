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
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_NODE_ID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
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
 */
function makeChrome() {
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
  const ROOTS: N[] = [
    {
      id: '0',
      title: '',
      children: [
        { id: '1', title: '书签栏', parentId: '0', index: 0, children: [] },
        { id: '2', title: '其他书签', parentId: '0', index: 1, children: [] },
        { id: '3', title: '移动设备书签', parentId: '0', index: 2, children: [] },
      ],
    },
  ];
  for (const r of ROOTS) seed(r);
  let seq = 0;

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
