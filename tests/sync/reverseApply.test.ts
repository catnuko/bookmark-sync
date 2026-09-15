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
 */
function makeChrome() {
  interface N extends ChromeTreeNode { parentId?: string; index?: number; url?: string; }
  const tree = new Map<string, N>();
  const seed = (n: N) => { tree.set(n.id, n); for (const c of n.children ?? []) seed(c); };
  const ROOTS: N[] = [
    { id: '0', title: '', children: [
      { id: '1', title: '书签栏', parentId: '0', index: 0, children: [] },
      { id: '2', title: '其他书签', parentId: '0', index: 1, children: [] },
      { id: '3', title: '移动设备书签', parentId: '0', index: 2, children: [] },
    ] },
  ];
  for (const r of ROOTS) seed(r);

  const api: ChromeBookmarksAPI = {
    getTree: async () => {
      const clone = (n: N): N => ({ ...n, children: (n.children ?? []).map(clone) });
      return ROOTS.map(clone);
    },
    getChildren: async (parentId: string) => {
      const p = tree.get(parentId);
      return (p?.children ?? []).map((c) => ({ ...c }));
    },
    create: async (props: { parentId: string; title?: string; url?: string; index?: number }) => {
      const id = 'n' + Math.random().toString(36).slice(2, 10);
      const node: N = { id, parentId: props.parentId, index: props.index ?? tree.get(props.parentId)!.children!.length, title: props.title ?? '', url: props.url, children: [] };
      tree.get(props.parentId)!.children!.push(node);
      tree.set(id, node);
      return { ...node };
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
      c.createNodeWithId('uu-1', BOOKMARKS_BAR_UUID, { title: '远端书签', url: 'https://remote.example' });
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
    await coordinator.createNodeWithId('uu-u', BOOKMARKS_BAR_UUID, { title: '旧标题', url: 'https://old' });

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
    await coordinator.createNodeWithId('uu-d', BOOKMARKS_BAR_UUID, { title: '要被删', url: 'https://x' });

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
    const menuChild = await chrome.create({ parentId: menuNode.id, title: '百度百科', url: 'https://baike.baidu.com' });
    bridge.map(menuChild.id, 'uu-menu-child');
    await coordinator.createNodeWithId('uu-menu-child', MENU_UUID, { title: '百度百科', url: 'https://baike.baidu.com' });

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
    await coordinator.createNodeWithId('uu-g', BOOKMARKS_BAR_UUID, { title: '复活', url: 'https://revive' });

    await expect(reverseApply(chrome, coordinator, bridge)).resolves.toBeUndefined();
    const bar = (await chrome.getTree())[0].children!.find((n) => n.id === '1')!;
    expect(bar.children!.length).toBe(1); // 重新创建而非报错
    expect(bar.children![0].title).toBe('复活');
    expect(bridge.toUuid(bar.children![0].id)).toBe('uu-g'); // 映射更新到新 chromeId
  });
});

describe('双向同步闭环（两设备经共享 transport）', () => {
  it('device A creates, device B syncs: op flows A→server→B→chrome', async () => {
    const devB = new SyncCoordinator({
      spaceId: SPACE, deviceId: 'dev-B', transport, key: sharedKey,
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
      spaceId: SPACE, deviceId: 'dev-B', transport, key: sharedKey,
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

    const treeA = coordinator.replica.getVisibleTree().map((e) => e.child).sort();
    const treeB = devB.replica.getVisibleTree().map((e) => e.child).sort();
    expect(treeA).toEqual(treeB);
    expect(treeA).toContain('uu-1');
    expect(treeA).toContain('uu-2');
  });
});
