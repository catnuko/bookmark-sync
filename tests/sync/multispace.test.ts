/**
 * tests/sync/multispace.test.ts — 多空间的本地投影隔离（设备绑定空间方案）。
 *
 * 背景：本机书签树 ≡ **绑定空间**，落地区恒为本环境原生根；映射表按空间一份
 * （`crdt.idmap.<spaceId>`）。换绑空间 = 清空本机投影 + 整表作废 + 从目标空间
 * 的 CRDT 重新投影。旧方案（B2 多容器并存）让两棵落地树在同一份书签里并存，
 * 带来「地址栏星标跑偏」等无法绕开的问题，已废弃。
 *
 * 本文件锁死的不变式：
 *   1. 映射按空间隔离：换绑后新空间的桥没有任何旧映射，reverseApply 对未映射
 *      节点一律不碰（本机书签不会被「顺手」删掉）；
 *   2. 桥缺失时（换绑清空进行中）本机删除事件不产生墓碑——否则清空会被当成
 *      「用户删除了书签」写进旧空间的 CRDT，真删云端数据；
 *   3. 落地根不是用户节点：不可被 map() 改写；
 *   4. 同一固定根不能被第二个 chromeId 抢占（防陈旧映射串号）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  IdBridge,
  captureLocalEvents,
  reverseApply,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import { generateKey, BOOKMARKS_BAR_UUID } from '../../src/crdt/index.js';

const SPACE_A = 'aaaaaaaa-0000-4000-8000-111111111111';
const SPACE_B = 'bbbbbbbb-0000-4000-8000-222222222222';

interface FakeNode extends ChromeTreeNode {
  parentId?: string;
  index?: number;
  url?: string;
  children?: FakeNode[];
}

/** 带调用记录的最小 chrome.bookmarks 假件（create/move 尊重 index，接近真机）。 */
function makeChrome() {
  const tree = new Map<string, FakeNode>();
  const removed: string[] = [];
  const created: string[] = [];
  const moved: Array<{ id: string; parentId: string; index: number }> = [];
  const removedListeners: Array<(id: string, info: { removedNode: ChromeTreeNode }) => void> = [];

  const reindex = (parentId: string) => {
    (tree.get(parentId)?.children ?? []).forEach((c, i) => {
      c.index = i;
    });
  };
  const detach = (id: string) => {
    const node = tree.get(id);
    if (!node?.parentId) return null;
    const parent = tree.get(node.parentId);
    if (parent?.children) parent.children = parent.children.filter((c) => c.id !== id);
    reindex(node.parentId);
    return node;
  };
  const seed = (n: FakeNode) => {
    tree.set(n.id, n);
    for (const c of n.children ?? []) {
      c.parentId = n.id;
      seed(c);
    }
    reindex(n.id);
  };

  const ROOTS: FakeNode[] = [
    {
      id: '0',
      title: '',
      children: [
        { id: '1', title: '书签栏', children: [] },
        { id: '2', title: '其他书签', children: [] },
        { id: '3', title: '移动设备书签', children: [] },
      ],
    },
  ];
  for (const r of ROOTS) seed(r);

  const api = {
    tree,
    removed,
    created,
    moved,
    getTree: async () => {
      const clone = (n: FakeNode): FakeNode => ({
        ...n,
        children: (n.children ?? []).map(clone),
      });
      return ROOTS.map(clone);
    },
    get: async (id: string | string[]) => {
      const ids = Array.isArray(id) ? id : [id];
      const found = ids.map((i) => tree.get(i)).filter(Boolean) as FakeNode[];
      if (found.length === 0) throw new Error('Bookmark not found');
      return found.map((n) => ({ id: n.id, title: n.title, parentId: n.parentId }));
    },
    getChildren: async (parentId: string) =>
      (tree.get(parentId)?.children ?? []).map((c) => ({ ...c })),
    create: async (props: { parentId: string; title?: string; url?: string; index?: number }) => {
      const id = 'n' + Math.random().toString(36).slice(2, 10);
      const parent = tree.get(props.parentId)!;
      parent.children = parent.children ?? [];
      const idx = Math.max(0, Math.min(props.index ?? parent.children.length, parent.children.length));
      const node: FakeNode = {
        id,
        parentId: props.parentId,
        title: props.title ?? '',
        url: props.url,
        children: [],
      };
      parent.children.splice(idx, 0, node);
      reindex(props.parentId);
      tree.set(id, node);
      created.push(id);
      return { ...node };
    },
    move: async (id: string, moveProps: { parentId: string; index?: number }) => {
      const node = detach(id)!;
      node.parentId = moveProps.parentId;
      const np = tree.get(moveProps.parentId)!;
      np.children = np.children ?? [];
      const idx = Math.max(0, Math.min(moveProps.index ?? np.children.length, np.children.length));
      np.children.splice(idx, 0, node);
      reindex(moveProps.parentId);
      moved.push({ id, parentId: moveProps.parentId, index: idx });
      return { ...node, index: idx };
    },
    update: async (id: string, changes: { title?: string; url?: string }) => {
      const node = tree.get(id)!;
      if (changes.title !== undefined) node.title = changes.title;
      if (changes.url !== undefined) node.url = changes.url;
      return { ...node };
    },
    remove: async (id: string) => {
      const node = detach(id);
      if (!node) return;
      tree.delete(id);
      removed.push(id);
    },
    removeTree: async (id: string) => {
      const collect = (nid: string): string[] => {
        const n = tree.get(nid);
        return n ? [nid, ...(n.children ?? []).flatMap((c) => collect(c.id))] : [nid];
      };
      const ids = collect(id);
      detach(id);
      for (const cid of ids) tree.delete(cid);
      removed.push(id);
    },
    onCreated: { addListener: () => {} },
    onChanged: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    onRemoved: {
      addListener: (cb: (id: string, info: { removedNode: ChromeTreeNode }) => void) => {
        removedListeners.push(cb);
      },
    },
    /** 模拟用户/浏览器删除（同步派发 listener 回调）。 */
    fireRemoved: (id: string, node: Partial<ChromeTreeNode> = {}) => {
      const info = { removedNode: { id, title: '', ...node } as ChromeTreeNode };
      for (const cb of removedListeners) void cb(id, info);
    },
  };
  return api as ChromeBookmarksAPI & typeof api;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let chrome: ReturnType<typeof makeChrome>;
let key: CryptoKey;

beforeEach(async () => {
  chrome = makeChrome();
  key = await generateKey();
});

const newCoordinator = async (spaceId: string, deviceId: string) =>
  new SyncCoordinator({
    spaceId,
    deviceId,
    transport: new MemoryOpLogTransport(),
    key,
  });

/** 在书签栏下放一个书签（模拟本机已有书签）。 */
function seedBookmark(id: string, title = '本机书签', url = 'https://local') {
  const bar = chrome.tree.get('1')!;
  const node: FakeNode = { id, parentId: '1', index: (bar.children ?? []).length, title, url };
  bar.children = [...(bar.children ?? []), node];
  chrome.tree.set(id, node);
}

describe('映射按空间隔离 / 换绑', () => {
  it('换绑后新空间的桥没有旧映射：本机已有书签不被删除', async () => {
    // 书签栏里的书签是**旧空间**的投影。换绑到 SPACE_B：新桥是空的，
    // 新空间的 CRDT 也是空的 —— reverseApply 必须对未映射节点无动于衷
    // （清空是 rebindSpace 的显式动作，不是投影的副作用）。
    seedBookmark('910', '旧空间的书签', 'https://old');
    const bridge = new IdBridge(undefined, { spaceId: SPACE_B });
    const coord = await newCoordinator(SPACE_B, 'dev-b');

    await reverseApply(chrome, coord, bridge);

    expect(chrome.removed).toEqual([]);
    expect(chrome.tree.has('910')).toBe(true);
  });

  it('桥缺失时（换绑清空进行中）删除事件不产生墓碑', async () => {
    const bridge = new IdBridge(undefined, { spaceId: SPACE_A });
    const coord = await newCoordinator(SPACE_A, 'dev-a');
    const uuid = '11111111-0000-4000-8000-000000000001';
    const uuid2 = '11111111-0000-4000-8000-000000000002';
    bridge.map('7', uuid);
    coord.createNodeWithId(uuid, BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a' });

    let active: IdBridge | null = bridge;
    captureLocalEvents(chrome, coord, () => active);

    const visible = (u: string) =>
      coord.replica.getVisibleTree().some((e) => e.child === u);

    expect(visible(uuid)).toBe(true);
    chrome.fireRemoved('7', { title: 'A' });
    await tick();
    expect(visible(uuid)).toBe(false); // 正常路径：删除生效（产生墓碑）

    // 换绑清空期间：活动桥被摘掉（dropBridgeCache）→ 事件处理器拿不到映射，
    // 清空产生的删除**不能**进 CRDT（否则等于用户删书签，云端数据被真删）。
    bridge.map('8', uuid2);
    coord.createNodeWithId(uuid2, BOOKMARKS_BAR_UUID, { title: 'B', url: 'https://b' });
    active = null;
    chrome.fireRemoved('8', { title: 'B' });
    await tick();
    expect(visible(uuid2)).toBe(true); // 事件被丢弃，CRDT 不受影响
  });
});

describe('IdBridge 基本不变量', () => {
  it('removeByChromeId / removeByUuid 双向清理', () => {
    const bridge = new IdBridge();
    bridge.map('c1', 'u1');
    bridge.removeByChromeId('c1');
    expect(bridge.toUuid('c1')).toBeNull();
    expect(bridge.toChromeId('u1')).toBeNull();

    bridge.map('c2', 'u2');
    bridge.removeByUuid('u2');
    expect(bridge.toUuid('c2')).toBeNull();
    expect(bridge.toChromeId('u2')).toBeNull();
  });

  it('落地根不可被 map() 改写', () => {
    const bridge = new IdBridge();
    expect(bridge.toUuid('1')).toBe(BOOKMARKS_BAR_UUID);
    bridge.map('1', 'evil-uuid');
    expect(bridge.toUuid('1')).toBe(BOOKMARKS_BAR_UUID); // 仍指向固定根
    expect(bridge.toChromeId('evil-uuid')).toBeNull();
  });

  it('同一固定根不能被第二个 chromeId 抢占（防陈旧映射串号）', () => {
    const bridge = new IdBridge();
    bridge.map('x1', 'dup-uuid');
    bridge.map('x2', 'dup-uuid'); // 覆盖：旧 chromeId 的 forward 必须被裁掉
    expect(bridge.toChromeId('dup-uuid')).toBe('x2');
    expect(bridge.toUuid('x1')).toBeNull();
  });

  it('换绑后旧空间的持久化映射不会被新桥继承（load 按实例隔离）', () => {
    const oldBridge = new IdBridge(undefined, { spaceId: SPACE_A });
    oldBridge.map('7', 'uuuuuuuu-0000-4000-8000-000000000001');
    const snapshot = oldBridge.snapshot();

    // 新空间的桥从空开始；旧空间的快照是另一个键（crdt.idmap.SPACE_A）
    const newBridge = new IdBridge(undefined, { spaceId: SPACE_B });
    expect(newBridge.toUuid('7')).toBeNull();
    expect(snapshot['7']).toBe('uuuuuuuu-0000-4000-8000-000000000001'); // 旧快照仍在，但不会被载入
  });
});
