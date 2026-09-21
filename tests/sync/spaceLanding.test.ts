/**
 * tests/sync/spaceLanding.test.ts — 空间落地区解析（B2 多容器并存）。
 *
 * 覆盖：
 *   - 默认空间 = 原生根落地，不建容器；
 *   - 非默认空间 = 书签栏下容器「书签空间 · <名>」落地，ROOT → 容器；
 *   - 容器/注册表的复用、重建、改名、已删空间行清理；
 *   - foreignRoots 只列其它空间的**容器**，绝不包含原生根（否则容器内节点会被
 *     判成「外来子树」，墓碑失效）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SPACE_ROOTS_KEY,
  loadSpaceRoots,
  persistSpaceLanding,
  resolveSpaceLanding,
  type LandingStorage,
  type SpaceLandingRow,
  type SpaceRootsRegistry,
} from '../../src/sync/spaceLanding.js';
import {
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
} from '../../src/crdt/index.js';
import type { ChromeBookmarksAPI, ChromeTreeNode } from '../../src/sync/index.js';

const DEFAULT_SPACE = { id: 'sp-default', name: '默认空间', is_default: true };
const WORK_SPACE = { id: 'sp-work', name: '工作', is_default: false };
const LIFE_SPACE = { id: 'sp-life', name: '生活', is_default: false };

interface FakeNode extends ChromeTreeNode {
  parentId?: string;
  children?: FakeNode[];
}

/** 极简 chrome.bookmarks 假件：只够 spaceLanding 用（create/get/update）。 */
function makeChrome() {
  const children: Record<string, FakeNode[]> = { '0': [] };
  const nodes = new Map<string, FakeNode>();
  let seq = 0;
  const mk = (id: string, parentId: string, title: string): FakeNode => {
    const node: FakeNode = { id, parentId, title, children: [] };
    nodes.set(id, node);
    (children[parentId] ??= []).push(node);
    children[id] = [];
    return node;
  };
  const root: FakeNode = { id: '0', title: '', children: [] };
  nodes.set('0', root);
  children['0'] = [];
  mk('1', '0', '书签栏');
  mk('2', '0', '其他书签');
  mk('3', '0', '移动设备书签');

  const api: ChromeBookmarksAPI = {
    getTree: async () => [root],
    get: async (id) => {
      const ids = Array.isArray(id) ? id : [id];
      const found = ids.map((i) => nodes.get(i)).filter(Boolean) as FakeNode[];
      if (found.length === 0) throw new Error('Bookmark not found');
      return found.map((n) => ({ id: n.id, title: n.title, parentId: n.parentId }));
    },
    getChildren: async (parentId: string) => [...(children[parentId] ?? [])],
    create: async (props) => {
      const node = mk(`n${++seq}`, props.parentId, props.title ?? '');
      return { ...node };
    },
    move: async (id, p) => {
      const node = nodes.get(id)!;
      children[node.parentId!] = children[node.parentId!].filter((n) => n.id !== id);
      node.parentId = p.parentId;
      (children[p.parentId] ??= []).push(node);
      return { ...node };
    },
    update: async (id, changes) => {
      const node = nodes.get(id)!;
      if (changes.title !== undefined) node.title = changes.title;
      return { ...node };
    },
    remove: async () => {},
    removeTree: async (id) => {
      const kill = (nid: string) => {
        for (const c of children[nid] ?? []) kill(c.id);
        delete children[nid];
        nodes.delete(nid);
        const node = nodes.get(nid);
        void node;
      };
      kill(id);
      for (const pid of Object.keys(children)) {
        children[pid] = children[pid].filter((n) => n.id !== id);
      }
    },
    onCreated: { addListener: () => {} },
    onChanged: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  };
  return { api, nodes, children };
}

/** 内存 storage 假件（对齐 chrome.storage.local 的 get(key)/set(obj) 形状）。 */
function makeStorage() {
  const data: Record<string, unknown> = {};
  const storage: LandingStorage & { data: Record<string, unknown> } = {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (obj) => {
      Object.assign(data, obj);
    },
  };
  return storage;
}

let chrome: ReturnType<typeof makeChrome>;
let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  chrome = makeChrome();
  storage = makeStorage();
});

const resolve = (space: { id: string; name: string; is_default: boolean }, spaces = [DEFAULT_SPACE, WORK_SPACE, LIFE_SPACE]) =>
  resolveSpaceLanding({
    chrome: chrome.api,
    storage,
    space,
    spaces,
    containerTitle: `书签空间 · ${space.name}`,
    isFirefox: false,
  });

describe('默认空间 = 原生根落地', () => {
  it('返回原生根表，不创建容器', async () => {
    const { landing } = await resolve(DEFAULT_SPACE);

    expect(landing.mode).toBe('native');
    expect(landing.rootId).toBe('0');
    expect(landing.roots).toEqual([
      ['0', ROOT_UUID],
      ['1', BOOKMARKS_BAR_UUID],
      ['2', OTHER_BOOKMARKS_UUID],
      ['3', '00000000-0000-4000-8000-000000000003'],
    ]);
    expect(chrome.children['1']).toHaveLength(0); // 没有建任何容器
  });

  it('foreignRoots = 其它空间的容器，不含原生根', async () => {
    await resolve(WORK_SPACE); // 先让工作空间有容器
    const { landing } = await resolve(DEFAULT_SPACE);

    const containerId = (await loadSpaceRoots(storage))[WORK_SPACE.id].rootId;
    expect(landing.foreignRoots).toEqual([containerId]);
    expect(landing.foreignRoots).not.toContain('0');
    expect(landing.foreignRoots).not.toContain('1');
  });
});

describe('非默认空间 = 书签栏下的容器落地区', () => {
  it('在书签栏下建容器并把 ROOT 指过去，同时登记注册表', async () => {
    const { landing, registry } = await resolve(WORK_SPACE);

    expect(landing.mode).toBe('container');
    const node = chrome.nodes.get(landing.rootId)!;
    expect(node.parentId).toBe('1'); // 落在书签栏下
    expect(node.title).toBe('书签空间 · 工作');
    expect(landing.roots).toEqual([[landing.rootId, ROOT_UUID]]); // 子文件夹还没建，只有 ROOT
    expect(registry[WORK_SPACE.id]).toEqual({ rootId: landing.rootId, sub: {} });
    expect(storage.data[SPACE_ROOTS_KEY]).toBeTruthy();
  });

  it('再次解析复用同一容器（不重复创建）', async () => {
    const first = await resolve(WORK_SPACE);
    const second = await resolve(WORK_SPACE);
    expect(second.landing.rootId).toBe(first.landing.rootId);
    expect(chrome.children['1']).toHaveLength(1);
  });

  it('登记过的固定根子文件夹会被注入 roots', async () => {
    const first = await resolve(WORK_SPACE);
    const subId = 'n-sub-bar';
    chrome.nodes.set(subId, { id: subId, parentId: first.landing.rootId, title: '书签栏', children: [] });
    chrome.children[first.landing.rootId] = [chrome.nodes.get(subId)!];
    chrome.children[subId] = [];

    const row: SpaceLandingRow = { rootId: first.landing.rootId, sub: { [BOOKMARKS_BAR_UUID]: subId } };
    const registry: SpaceRootsRegistry = { [WORK_SPACE.id]: row };
    storage.data[SPACE_ROOTS_KEY] = registry;

    const { landing } = await resolve(WORK_SPACE);
    expect(landing.roots).toContainEqual([subId, BOOKMARKS_BAR_UUID]);
  });

  it('子文件夹被用户删掉后从 roots 里剔除（下次投影会重建）', async () => {
    const first = await resolve(WORK_SPACE);
    storage.data[SPACE_ROOTS_KEY] = {
      [WORK_SPACE.id]: { rootId: first.landing.rootId, sub: { [BOOKMARKS_BAR_UUID]: 'gone-id' } },
    };
    const { landing } = await resolve(WORK_SPACE);
    expect(landing.roots).toEqual([[first.landing.rootId, ROOT_UUID]]);
  });

  it('容器被删后重建为新容器', async () => {
    const first = await resolve(WORK_SPACE);
    await chrome.api.removeTree(first.landing.rootId);
    const second = await resolve(WORK_SPACE);
    expect(second.landing.rootId).not.toBe(first.landing.rootId);
    expect(chrome.nodes.has(second.landing.rootId)).toBe(true);
  });

  it('空间改名后同步容器标题（识别只靠注册表，不看标题）', async () => {
    const first = await resolve(WORK_SPACE);
    await resolve({ ...WORK_SPACE, name: '工作·新版' });
    expect(chrome.nodes.get(first.landing.rootId)!.title).toBe('书签空间 · 工作·新版');
  });

  it('容器空间的 foreignRoots 只含其它空间的容器（不含原生根）', async () => {
    await resolve(LIFE_SPACE);
    const { landing } = await resolve(WORK_SPACE);
    const lifeContainer = (await loadSpaceRoots(storage))[LIFE_SPACE.id].rootId;

    expect(landing.foreignRoots).toEqual([lifeContainer]);
    expect(landing.foreignRoots).not.toContain('0');
    expect(landing.foreignRoots).not.toContain('1');
  });

  it('已删空间的注册表行被清理', async () => {
    await resolve(WORK_SPACE);
    await resolve(LIFE_SPACE);
    // 「生活」空间被删除（spaces 里不再有它）
    const { registry } = await resolve(WORK_SPACE, [DEFAULT_SPACE, WORK_SPACE]);
    expect(registry[LIFE_SPACE.id]).toBeUndefined();
    expect(registry[WORK_SPACE.id]).toBeTruthy();
  });
});

describe('注册表只描述容器——原生根绝不可成为 foreign', () => {
  it('默认空间先解析（真实启动顺序），容器空间的 foreignRoots 里不出现原生根', async () => {
    // 真机启动顺序：默认空间先同步若干轮，之后用户才建/切到「工作」空间。
    // 若默认空间把自己的原生根登记进注册表，容器空间就会把「0」（整棵书签树
    // 的祖先）当成外来根 → 容器内每个节点都被判成「外来子树」
    // → removeTrashedNodes 全部跳过 → 墓碑（删除）在容器空间彻底失效。
    await resolve(DEFAULT_SPACE);
    const { landing } = await resolve(WORK_SPACE);

    expect(landing.foreignRoots).not.toContain('0');
    expect(landing.foreignRoots).not.toContain('1');
    expect(landing.foreignRoots).toEqual([]);
  });

  it('默认空间不在注册表里留行（注册表 = 容器注册表）', async () => {
    await resolve(DEFAULT_SPACE);
    expect((await loadSpaceRoots(storage))[DEFAULT_SPACE.id]).toBeUndefined();
  });

  it('注册表里的原生根脏数据（旧版本写入）也不会变成 foreignRoots', async () => {
    storage.data[SPACE_ROOTS_KEY] = {
      [DEFAULT_SPACE.id]: { rootId: '0' },
      [LIFE_SPACE.id]: { rootId: 'n-life-container' },
    };
    const { landing } = await resolve(WORK_SPACE);
    expect(landing.foreignRoots).toEqual(['n-life-container']);
  });
});

describe('persistSpaceLanding', () => {
  it('把按需创建出来的子文件夹写回注册表；默认空间不登记', async () => {
    const { landing } = await resolve(WORK_SPACE);
    const registry = await loadSpaceRoots(storage);

    await persistSpaceLanding(storage, WORK_SPACE, registry, {
      rootId: landing.rootId,
      sub: { [OTHER_BOOKMARKS_UUID]: 'sub-other' },
    });
    expect((await loadSpaceRoots(storage))[WORK_SPACE.id]).toEqual({
      rootId: landing.rootId,
      sub: { [OTHER_BOOKMARKS_UUID]: 'sub-other' },
    });

    await persistSpaceLanding(storage, DEFAULT_SPACE, await loadSpaceRoots(storage), {
      rootId: '9',
      sub: {},
    });
    expect((await loadSpaceRoots(storage))[DEFAULT_SPACE.id]).toBeUndefined();
  });
});
