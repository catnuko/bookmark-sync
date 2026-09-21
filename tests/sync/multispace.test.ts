/**
 * tests/sync/multispace.test.ts — 多空间（B2 多容器并存）本地隔离回归。
 *
 * 背景：同一份 chrome.bookmarks 里并存多棵落地树——默认空间占原生根，其它空间
 * 各占书签栏下的一个容器文件夹。映射表按空间各一份。若没有空间维度，切到空间
 * B 时本机节点会全部「已映射但不可达」→ removeTrashedNodes 把用户书签整棵删掉
 * （本机书签被清空）。
 *
 * 本文件锁死的不变式：
 *   1. 外来容器（其它空间的落地树）即使被误映射进本空间，也绝不被删除；
 *   2. 外来容器子树绝不被捕获进本空间 CRDT（否则切空间会互相吸走内容）；
 *   3. 容器空间的捕获只走自己的容器——原生书签栏里的书签绝不进容器空间；
 *   4. 容器空间的固定根（书签栏/其他书签/…）按需落地，空的不建、幂等不 churn；
 *   5. 默认空间面对外来容器不产生额外 move（每个 index 都是「自有兄弟中的位次」）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  IdBridge,
  captureLocalTree,
  reverseApply,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
} from '../../src/crdt/index.js';

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

  const api: ChromeBookmarksAPI & {
    tree: Map<string, FakeNode>;
    removed: string[];
    created: string[];
    moved: typeof moved;
  } = {
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
    // 真机 chrome.bookmarks.get 返回不带 children 的单节点；不存在的 id 会 reject。
    get: async (id) => {
      const ids = Array.isArray(id) ? id : [id];
      const found = ids.map((i) => tree.get(i)).filter(Boolean) as FakeNode[];
      if (found.length === 0) throw new Error('Bookmark not found');
      return found.map((n) => ({ id: n.id, title: n.title, parentId: n.parentId }));
    },
    getChildren: async (parentId: string) =>
      (tree.get(parentId)?.children ?? []).map((c) => ({ ...c })),
    create: async (props) => {
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
    move: async (id, moveProps) => {
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
    update: async (id, changes) => {
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
    onRemoved: { addListener: () => {} },
  };
  return api;
}

/** 在书签栏下塞一个「其它空间的落地容器」子树：容器 '900' 内含 '901'。 */
function seedForeignContainer(chrome: ReturnType<typeof makeChrome>) {
  const bar = chrome.tree.get('1')!;
  const child: FakeNode = { id: '901', parentId: '900', index: 0, title: '其它空间的书签', url: 'https://other' };
  const container: FakeNode = { id: '900', parentId: '1', index: 0, title: '书签空间 · 其它', children: [child] };
  bar.children = [container, ...(bar.children ?? [])];
  bar.children.forEach((c, i) => {
    c.index = i;
  });
  chrome.tree.set('900', container);
  chrome.tree.set('901', child);
}

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

describe('外来容器（其它空间的落地树）', () => {
  it('即使 uuids 不可达也不删除外来容器及其子树', async () => {
    seedForeignContainer(chrome);
    // 本空间误把外来容器映射成自己的节点，且其 uuid 在 CRDT 中不存在（不可达）
    // ——旧实现会 removeTree；新实现必须整棵跳过。
    const bridge = new IdBridge(undefined, { spaceId: SPACE_B, foreignRoots: ['900'] });
    bridge.map('900', 'ffffffff-0000-4000-8000-999999999999');
    bridge.map('901', 'ffffffff-0000-4000-8000-888888888888');

    const coord = await newCoordinator(SPACE_B, 'dev-b');
    await reverseApply(chrome, coord, bridge);

    expect(chrome.removed).toEqual([]); // 没有删除任何节点
    expect(chrome.tree.has('900')).toBe(true); // 容器还在
    expect(chrome.tree.has('901')).toBe(true); // 容器内的书签也在
  });

  it('captureLocalTree 不把外来容器子树捕获进本空间 CRDT', async () => {
    seedForeignContainer(chrome);
    const bridge = new IdBridge(undefined, { spaceId: SPACE_B, foreignRoots: ['900'] });
    const coord = await newCoordinator(SPACE_B, 'dev-b');

    const captured = await captureLocalTree(chrome, coord, bridge);

    expect(captured).toBe(0); // 外来子树被整棵跳过
    expect(bridge.toUuid('900')).toBeNull(); // 容器未被映射
    expect(bridge.toUuid('901')).toBeNull(); // 容器内书签未被映射
  });

  it('map() 拒绝把外来容器纳入本空间映射', () => {
    const bridge = new IdBridge(undefined, { foreignRoots: ['900'] });
    expect(bridge.isForeign('900')).toBe(true);
    bridge.map('900', 'whatever-uuid');
    expect(bridge.toUuid('900')).toBeNull();
  });
});

describe('容器空间（B2 非默认空间）', () => {
  const containerBridge = (sub: Array<[string, string]> = []) =>
    new IdBridge(undefined, {
      spaceId: SPACE_B,
      nativeRoots: false,
      roots: [['900', ROOT_UUID], ...sub],
      foreignRoots: [],
    });

  it('落地根注入：容器 → ROOT_UUID，容器内子文件夹 → BAR/OTHER', () => {
    const bridge = containerBridge([
      ['901', BOOKMARKS_BAR_UUID],
      ['902', OTHER_BOOKMARKS_UUID],
    ]);

    // 本空间的落地：BAR 写在容器内的子文件夹 901，而不是原生书签栏 "1"
    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBe('901');
    expect(bridge.toChromeId(OTHER_BOOKMARKS_UUID)).toBe('902');
    expect(bridge.nativeRoots).toBe(false);
    // 原生根不属于本空间（无映射）——注意**不能**登记为 foreign：容器本身挂在
    // 原生书签栏下，把祖先登记成 foreign 会让容器内所有节点被判「外来子树」，
    // 从此再也删不掉（墓碑失效）。
    expect(bridge.toUuid('1')).toBeNull();
    expect(bridge.isForeign('1')).toBe(false);
  });

  it('两空间的映射互不可见（同一 chromeId 各自独立）', () => {
    const a = new IdBridge(undefined, { spaceId: SPACE_A }); // 默认空间 = 原生根
    const b = containerBridge([['901', BOOKMARKS_BAR_UUID]]);

    expect(a.toUuid('1')).toBe(BOOKMARKS_BAR_UUID); // A：原生书签栏是 BAR 落地
    expect(b.toUuid('1')).toBeNull(); // B：原生书签栏不可见
    expect(a.toChromeId(BOOKMARKS_BAR_UUID)).toBe('1');
    expect(b.toChromeId(BOOKMARKS_BAR_UUID)).toBe('901');
  });

  it('捕获只走自己的容器：原生书签栏里的书签绝不进容器空间', async () => {
    // 原生书签栏里有一个「别人的」书签 '910'
    const bar = chrome.tree.get('1')!;
    bar.children = [{ id: '910', parentId: '1', index: 0, title: '原生书签', url: 'https://native' }];
    chrome.tree.set('910', bar.children[0]);
    // 本空间的容器 '900'，里面有一个书签 '901'
    const child: FakeNode = { id: '901', parentId: '900', index: 0, title: '容器内书签', url: 'https://in' };
    const container: FakeNode = { id: '900', parentId: '1', index: 1, title: '书签空间 · B', children: [child] };
    bar.children.push(container);
    bar.children.forEach((c, i) => {
      c.index = i;
    });
    chrome.tree.set('900', container);
    chrome.tree.set('901', child);

    const bridge = containerBridge();
    const coord = await newCoordinator(SPACE_B, 'dev-b');

    const captured = await captureLocalTree(chrome, coord, bridge, '900');

    expect(captured).toBe(1); // 只有容器内的 '901'
    const uuid = bridge.toUuid('901');
    expect(uuid).toBeTruthy();
    expect(coord.replica.getParent(uuid!)).toBe(ROOT_UUID); // 用户直接丢进容器的书签挂在 ROOT 下
    expect(bridge.toUuid('910')).toBeNull(); // 原生书签栏里的书签未被吸进本空间
    expect(bridge.toUuid('900')).toBe(ROOT_UUID); // 容器 = 落地根
  });

  it('固定根按需落地：有内容才在容器内建子文件夹，且重复投影幂等', async () => {
    const container: FakeNode = { id: '900', parentId: '1', index: 0, title: '书签空间 · B', children: [] };
    chrome.tree.get('1')!.children = [container];
    chrome.tree.set('900', container);

    const bridge = containerBridge();
    const coord = await newCoordinator(SPACE_B, 'dev-b');
    const bm = '11111111-0000-4000-8000-000000000001';
    coord.createNodeWithId(bm, BOOKMARKS_BAR_UUID, { title: '我的书签', url: 'https://bm' });

    await reverseApply(chrome, coord, bridge);
    const barSub = bridge.toChromeId(BOOKMARKS_BAR_UUID);
    expect(barSub).toBeTruthy(); // 书签栏子文件夹按需建出来了
    expect(chrome.tree.get(barSub!)!.parentId).toBe('900'); // 建在容器内
    expect(chrome.tree.get(barSub!)!.title).toBe('书签栏');
    const bmId = bridge.toChromeId(bm);
    expect(bmId).toBeTruthy();
    expect(chrome.tree.get(bmId!)!.parentId).toBe(barSub); // 书签投影到容器内的书签栏

    // 幂等：第二轮不再新建任何节点（容器、子文件夹、书签都已落地）
    const createdBefore = chrome.created.length;
    await reverseApply(chrome, coord, bridge);
    expect(chrome.created.length).toBe(createdBefore);
    expect(chrome.removed).toEqual([]);
  });

  it('固定根为空时不建子文件夹（不留空文件夹）', async () => {
    const container: FakeNode = { id: '900', parentId: '1', index: 0, title: '书签空间 · B', children: [] };
    chrome.tree.get('1')!.children = [container];
    chrome.tree.set('900', container);

    const bridge = containerBridge();
    const coord = await newCoordinator(SPACE_B, 'dev-b');
    await reverseApply(chrome, coord, bridge);

    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBeNull();
    expect(bridge.toChromeId(OTHER_BOOKMARKS_UUID)).toBeNull();
    expect(bridge.toChromeId(MOBILE_UUID)).toBeNull();
    expect(chrome.created).toEqual([]);
  });

  it('原生根绝不被接受为外来容器（否则容器空间墓碑全失效）', async () => {
    // 容器 '900' 挂在原生书签栏 '1'（其父为原生根 '0'）之下，内含待删书签 '901'。
    const dead: FakeNode = { id: '901', parentId: '900', index: 0, title: '要被删的', url: 'https://dead' };
    const container: FakeNode = { id: '900', parentId: '1', index: 0, title: '书签空间 · B', children: [dead] };
    chrome.tree.get('1')!.children = [container];
    chrome.tree.set('900', container);
    chrome.tree.set('901', dead);

    // 脏参数：模拟「注册表把默认空间的原生根也登记了」时算出的 foreignRoots。
    const bridge = new IdBridge(undefined, {
      spaceId: SPACE_B,
      nativeRoots: false,
      roots: [['900', ROOT_UUID]],
      foreignRoots: ['0', '1'],
    });
    expect(bridge.isForeign('0')).toBe(false); // 结构性拒绝
    expect(bridge.isForeign('1')).toBe(false);
    bridge.addForeignRoot('0');
    expect(bridge.isForeign('0')).toBe(false);

    const coord = await newCoordinator(SPACE_B, 'dev-b');
    bridge.map('901', 'dddddddd-0000-4000-8000-000000000001'); // CRDT 中不可达 = 已墓碑

    await reverseApply(chrome, coord, bridge);

    // 祖先链上出现原生根不能豁免删除，否则容器空间的删除永远不生效。
    expect(chrome.tree.has('901')).toBe(false);
  });

  it('removeByChromeId / removeByUuid 双向清理（补历史缺失方法）', () => {
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

  it('落地根不可被 map() 改写（原生空间行为不变）', () => {
    const bridge = new IdBridge();
    expect(bridge.toUuid('1')).toBe(BOOKMARKS_BAR_UUID);
    bridge.map('1', 'evil-uuid');
    expect(bridge.toUuid('1')).toBe(BOOKMARKS_BAR_UUID); // 仍指向固定根
    expect(bridge.toChromeId('evil-uuid')).toBeNull();
  });

  it('同一固定根不能被第二个 chromeId 抢占', () => {
    const bridge = new IdBridge();
    bridge.map('x1', 'dup-uuid');
    bridge.map('x2', 'dup-uuid'); // 覆盖：旧 chromeId 的 forward 必须被裁掉（防陈旧映射串号）
    expect(bridge.toChromeId('dup-uuid')).toBe('x2');
    expect(bridge.toUuid('x1')).toBeNull();
  });
});

describe('默认空间：外来容器只被跳过，不产生额外搬动', () => {
  it('外来容器插在自有节点前面时，投影不把它当兄弟位次（否则每轮都搬一次）', async () => {
    // bar = [900(外来容器), 7(本空间已映射节点)]——外来容器排在自有节点前面，
    // 这是「按绝对 index 比较」最容易 churn 的形状。
    const bar = chrome.tree.get('1')!;
    const own: FakeNode = { id: '7', parentId: '1', index: 1, title: 'A', url: 'https://a' };
    const container: FakeNode = { id: '900', parentId: '1', index: 0, title: '书签空间 · 其它', children: [] };
    bar.children = [container, own];
    bar.children.forEach((c, i) => {
      c.index = i;
    });
    chrome.tree.set('7', own);
    chrome.tree.set('900', container);

    const bridge = new IdBridge(undefined, { spaceId: SPACE_A, foreignRoots: ['900'] });
    const coord = await newCoordinator(SPACE_A, 'dev-a');
    const b1 = '11111111-0000-4000-8000-00000000000a';
    const b2 = '11111111-0000-4000-8000-00000000000b';
    bridge.map('7', b1);
    coord.createNodeWithId(b1, BOOKMARKS_BAR_UUID, { title: 'A', url: 'https://a', position: 'a0' });
    coord.createNodeWithId(b2, BOOKMARKS_BAR_UUID, { title: 'B', url: 'https://b', position: 'a1' });

    await reverseApply(chrome, coord, bridge);
    expect(chrome.moved).toEqual([]); // 自有节点已在正确位次：不该为了避开外来容器而搬动
    expect(chrome.removed).toEqual([]);
    expect(chrome.tree.has('900')).toBe(true); // 外来容器原样保留

    await reverseApply(chrome, coord, bridge);
    expect(chrome.moved).toEqual([]); // 第二轮同样稳定
    expect(chrome.tree.has('900')).toBe(true);
  });
});
