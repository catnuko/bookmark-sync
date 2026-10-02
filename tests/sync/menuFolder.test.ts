/**
 * tests/sync/menuFolder.test.ts — Chromium 端「书签菜单」动态容器的落地。
 *
 * 回归来源（2026-10-02 真机）：ensureMenuFolder 曾把 parentId **硬编码成 "1"**
 * （本地书签栏的固定 chromeId）。在「已登录 + 本地子树为空」的设备上 Chrome
 * **根本不创建**本地根（真机核实 `get("1"/"2"/"3")` 全抛 "Can't find bookmark
 * for id."），于是 `chrome.create({parentId:"1"})` 抛错 → 整轮 reverseApply 被
 * 中断，**本轮所有书签都不落地**（不止菜单容器）。
 *
 * 修法：父节点从 `bridge.toChromeId(BOOKMARKS_BAR_UUID)` 解析；解析不到就返回
 * false 交给调用方提示用户，**绝不**退到账号（syncing）子树 —— 那会把本地内容
 * 上传到 Google 账号，且因 contentKey 含 parentUuid 造成云端翻倍（见 chromeBridge
 * 的 FALLBACK_ROOT_UUID 注释）。
 *
 * ⚠ 编排层（src/sync.ts）在模块加载时就把 `globalThis.chrome` 快照成 `api`
 * （见 src/lib/ext.ts），所以 chrome mock **必须在 import 之前**装好 —— 用
 * `vi.hoisted`（先于 import 执行）而不是 beforeAll。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** 编排层用的持久化键（src/sync.ts 的 MENU_FOLDER_KEY，未导出，这里按字面量锁定）。 */
const MENU_FOLDER_KEY = 'crdt.menuFolderId';

const h = vi.hoisted(() => {
  const storage = new Map<string, unknown>();
  const creates: Array<{ id: string; parentId: string; title?: string }> = [];
  const existing = new Set<string>();
  let seq = 0;
  const mock = {
    storage: {
      local: {
        async get(key?: string | string[] | Record<string, unknown> | null) {
          const out: Record<string, unknown> = {};
          if (typeof key === 'string') {
            if (storage.has(key)) out[key] = storage.get(key);
          } else if (Array.isArray(key)) {
            for (const k of key) if (storage.has(k)) out[k] = storage.get(k);
          } else if (key && typeof key === 'object') {
            for (const [k, dflt] of Object.entries(key))
              out[k] = storage.has(k) ? storage.get(k) : dflt;
          } else {
            for (const [k, v] of storage) out[k] = v;
          }
          return out;
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) storage.set(k, v);
        },
        async remove(keys: string | string[]) {
          for (const k of Array.isArray(keys) ? keys : [keys]) storage.delete(k);
        },
      },
    },
    bookmarks: {
      // 真实 Chrome：id 不存在时抛 "Can't find bookmark for id."（不是返回空数组）
      async get(id: string) {
        if (existing.has(id)) return [{ id, title: '' }];
        throw new Error("Can't find bookmark for id.");
      },
      async create(props: { parentId: string; title?: string; url?: string; index?: number }) {
        // 真实 Chrome：父节点不存在时 create 直接抛（不是静默创建）——这正是
        // 旧实现硬编码 parentId:"1" 在「本地子树为空」设备上炸掉整轮的原因。
        if (!existing.has(props.parentId)) throw new Error("Can't find bookmark for id.");
        const id = 'menu-' + ++seq;
        creates.push({ id, parentId: props.parentId, title: props.title });
        existing.add(id);
        return { id, ...props };
      },
    },
    i18n: { getMessage: () => '', getUILanguage: () => 'zh-CN' },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = mock;
  return {
    storage,
    creates,
    existing,
    mock,
    reset() {
      storage.clear();
      creates.length = 0;
      existing.clear();
      seq = 0;
    },
  };
});

import { ensureMenuFolder } from '../../src/sync.js';
import { IdBridge, resolveRoots } from '../../src/sync/index.js';
import { BOOKMARKS_BAR_UUID, MENU_UUID, ACCOUNT_BOOKMARKS_BAR_UUID } from '../../src/crdt/index.js';
import type { ChromeTreeNode } from '../../src/sync/index.js';

const MENU_TITLE = '书签菜单';

/** 已登录 + 本地子树为空：getTree() 里只有账号根（真机 2026-10-02 的形状）。 */
const ACCOUNT_ONLY_TREE: ChromeTreeNode[] = [
  {
    id: '0',
    title: '',
    children: [
      { id: '5', title: '书签栏', folderType: 'bookmarks-bar', syncing: true, children: [] },
      { id: '6', title: '其他书签', folderType: 'other', syncing: true, children: [] },
    ],
  },
];

beforeEach(() => {
  h.reset();
});

describe('ensureMenuFolder（Chromium 端「书签菜单」动态容器）', () => {
  it('本机没有本地书签栏 → 返回 false、不创建、绝不落到账号子树', async () => {
    // 桥由真实解析结果播种：本地根无映射，账号根有。
    const { pairs } = resolveRoots(ACCOUNT_ONLY_TREE, false);
    const bridge = new IdBridge(undefined, { roots: pairs });
    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBeNull();
    expect(bridge.toChromeId(ACCOUNT_BOOKMARKS_BAR_UUID)).toBe('5');
    // 本机只有账号根存在（本地根 "1"/"2"/"3" 不存在 —— 真机 2026-10-02）
    h.existing.add('5');
    h.existing.add('6');

    await expect(ensureMenuFolder(bridge)).resolves.toBe(false);

    // 没有创建任何 chrome 节点（尤其没有落到账号书签栏 "5" 下）
    expect(h.creates).toEqual([]);
    // 没有留下映射 / 持久化键
    expect(bridge.toChromeId(MENU_UUID)).toBeNull();
    expect(h.storage.has(MENU_FOLDER_KEY)).toBe(false);
  });

  it('本机有本地书签栏 → 挂在它下面（而不是硬编码的 "1"）并绑定 MENU_UUID', async () => {
    // 用一个**非 "1"** 的本地书签栏 chromeId 播种，锁定「父来自 bridge 而非硬编码」。
    // （不能用 map() 改写：1 是受保护的原生根，map 会拒绝。）
    const bridge = new IdBridge(undefined, { roots: [['local-bar-9', BOOKMARKS_BAR_UUID]] });
    expect(bridge.toChromeId(BOOKMARKS_BAR_UUID)).toBe('local-bar-9');
    h.existing.add('local-bar-9');

    await expect(ensureMenuFolder(bridge)).resolves.toBe(true);

    expect(h.creates).toEqual([{ id: 'menu-1', parentId: 'local-bar-9', title: MENU_TITLE }]);
    expect(bridge.toChromeId(MENU_UUID)).toBe('menu-1');
    expect(h.storage.get(MENU_FOLDER_KEY)).toBe('menu-1');
  });

  it('已保存的容器仍在 → 直接复用，不重复创建', async () => {
    const bridge = new IdBridge();
    bridge.map('menu-old', MENU_UUID);
    h.storage.set(MENU_FOLDER_KEY, 'menu-old');
    h.existing.add('menu-old');

    await expect(ensureMenuFolder(bridge)).resolves.toBe(true);
    expect(h.creates).toEqual([]);
  });

  it('已保存的容器已被删除 → 重建（get 抛错不冒泡）', async () => {
    const bridge = new IdBridge();
    h.storage.set(MENU_FOLDER_KEY, 'gone'); // 未登记进 existing → get 会抛
    h.existing.add('1'); // 本地书签栏存在

    await expect(ensureMenuFolder(bridge)).resolves.toBe(true);
    expect(h.creates).toEqual([{ id: 'menu-1', parentId: '1', title: MENU_TITLE }]);
    expect(h.storage.get(MENU_FOLDER_KEY)).toBe('menu-1');
  });
});
