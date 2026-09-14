/**
 * Chrome bookmarks <-> Move-CRDT bridge (Phase C-2).
 *
 * This is the ONLY module that touches chrome.bookmarks. It adapts:
 *   local chrome events            -> coordinator.create/move/delete
 *   remote CRDT state (after pull)  -> reverse-applied to chrome.bookmarks
 *
 * Root topology (identical on every device, fixed UUIDs):
 *   __root__
 *     └─ ROOT_UUID                    (chrome root id "0")
 *          ├─ BOOKMARKS_BAR_UUID      (chrome "1", folderType 'bookmarks-bar')
 *          ├─ OTHER_BOOKMARKS_UUID    (chrome "2", folderType 'other')
 *          ├─ MOBILE_UUID             (chrome "3", folderType 'mobile')
 *          └─ MENU_UUID               (Firefox "menu________" 书签菜单；
 *                                      Chromium 端 = bsync 自动管理的
 *                                      「书签菜单」文件夹，动态 chromeId)
 *
 * We never create/delete the special roots; only ordinary nodes are mapped.
 * MENU_UUID 在 Chromium 端的动态容器由 sync.js ensureMenuFolder 创建并映射，
 * 事件层把「已映射到固定根的动态 id」当固定根处理（不产生 CRDT op）。
 *
 * TODO(real-chrome): verify numeric ids "1"/"2"/"3" map to bar/other/mobile on
 * a real profile; fall back to node.folderType (Chrome 134+) if they differ.
 */

import type { Metadata } from '../crdt/index.js';
import {
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
  CHROME_ROOT_ID,
} from '../crdt/index.js';
import type { SyncCoordinator } from './syncEngine.js';

/** Minimal chrome.bookmarks surface we depend on (ease of testing). */
export interface ChromeBookmarksAPI {
  getTree(): Promise<ChromeTreeNode[]>;
  get(id: string | string[]): Promise<ChromeTreeNode[]>;
  /** NOTE: 真实 chrome.bookmarks.create 是单对象签名 create(details)。 */
  create(props: { parentId: string; title?: string; url?: string; index?: number }): Promise<ChromeTreeNode>;
  move(id: string, moveProps: { parentId: string; index?: number }): Promise<ChromeTreeNode>;
  update(id: string, changes: { title?: string; url?: string }): Promise<ChromeTreeNode>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
  getChildren(parentId: string): Promise<ChromeTreeNode[]>;
  onCreated: BrowserEvent<[string, ChromeTreeNode]>;
  onChanged: BrowserEvent<[string, { title: string; url?: string }]>;
  onMoved: BrowserEvent<[string, { parentId: string; oldParentId: string; index: number; oldIndex: number }]>;
  onRemoved: BrowserEvent<[string, { removedNode: ChromeTreeNode }]>;
}

interface BrowserEvent<T extends unknown[]> {
  addListener(cb: (...args: T) => void): void;
}

export interface ChromeTreeNode {
  id: string;
  parentId?: string;
  index?: number;
  title: string;
  url?: string;
  children?: ChromeTreeNode[];
  folderType?: string;
}

/**
 * chromeId -> fixed root UUID, or null for ordinary nodes.
 * 跨浏览器根 id：Chrome 用数字 "0"/"1"/"2"/"3"，Firefox 用 guid
 * （root________ / menu________ / toolbar_____ / unfiled_____ / mobile______）。
 * Firefox 的 menu________（书签菜单）映射 MENU_UUID（P3 后参与同步）。
 */
function fixedRootUuid(chromeId: string): string | null {
  switch (chromeId) {
    case CHROME_ROOT_ID: return ROOT_UUID; // Chrome "0"
    case 'root________': return ROOT_UUID; // Firefox root
    case '1': return BOOKMARKS_BAR_UUID; // Chrome 书签栏
    case 'toolbar_____': return BOOKMARKS_BAR_UUID; // Firefox 书签工具栏
    case '2': return OTHER_BOOKMARKS_UUID; // Chrome 其他书签
    case 'unfiled_____': return OTHER_BOOKMARKS_UUID; // Firefox 其他书签
    case '3': return MOBILE_UUID; // Chrome 移动书签
    case 'mobile______': return MOBILE_UUID; // Firefox 移动书签
    case 'menu________': return MENU_UUID; // Firefox 书签菜单
    default: return null;
  }
}

/** 运行环境是否为 Firefox（根 id 体系不同：guid vs 数字）。 */
export const IS_FIREFOX =
  typeof navigator !== "undefined" && /Firefox\//.test(navigator.userAgent);

/** 已知固定根 chromeId -> uuid（跨环境全集，forward 用）。 */
const ALL_ROOT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [CHROME_ROOT_ID, ROOT_UUID],
  ['root________', ROOT_UUID],
  ['1', BOOKMARKS_BAR_UUID],
  ['toolbar_____', BOOKMARKS_BAR_UUID],
  ['2', OTHER_BOOKMARKS_UUID],
  ['unfiled_____', OTHER_BOOKMARKS_UUID],
  ['3', MOBILE_UUID],
  ['mobile______', MOBILE_UUID],
  ['menu________', MENU_UUID],
];
/** Chrome 环境的根（backward 用）。 */
const CHROME_ROOT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [CHROME_ROOT_ID, ROOT_UUID],
  ['1', BOOKMARKS_BAR_UUID],
  ['2', OTHER_BOOKMARKS_UUID],
  ['3', MOBILE_UUID],
];
/** Firefox 环境的根（backward 用；menu________ 映射 MENU_UUID）。 */
const FF_ROOT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['root________', ROOT_UUID],
  ['menu________', MENU_UUID],
  ['toolbar_____', BOOKMARKS_BAR_UUID],
  ['unfiled_____', OTHER_BOOKMARKS_UUID],
  ['mobile______', MOBILE_UUID],
];
const CHROME_ROOT_IDS = new Set(CHROME_ROOT_PAIRS.map(([cid]) => cid));
const FF_ROOT_IDS = new Set(FF_ROOT_PAIRS.map(([cid]) => cid));

/**
 * In-memory chromeId <-> uuid map. Persistence (UuidMappingStore) owns the
 * durable layer; this cache is warmed at start and written-through.
 *
 * backward 只 seed 本环境的根 id：若 Chrome/Firefox 根都 seed，同一 uuid 的
 * backward 会被后写覆盖（OTHER ← 'unfiled_____' 覆盖 '2'），Chromium 下
 * toChromeId(OTHER) 会返回 Firefox guid → chrome "Bookmark id is invalid."。
 */
export class IdBridge {
  private forward = new Map<string, string>(); // chromeId -> uuid
  private backward = new Map<string, string>(); // uuid -> chromeId

  constructor(private readonly onChange?: () => void) {
    for (const [cid, uuid] of ALL_ROOT_PAIRS) this.forward.set(cid, uuid);
    for (const [cid, uuid] of (IS_FIREFOX ? FF_ROOT_PAIRS : CHROME_ROOT_PAIRS)) {
      this.backward.set(uuid, cid);
    }
  }

  toUuid(chromeId: string): string | null {
    return this.forward.get(chromeId) ?? null;
  }

  toChromeId(uuid: string): string | null {
    return this.backward.get(uuid) ?? null;
  }

  map(chromeId: string, uuid: string): void {
    this.forward.set(chromeId, uuid);
    this.backward.set(uuid, chromeId);
    this.onChange?.();
  }

  /** Durable snapshot: chromeId -> uuid (fixed roots included). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.forward);
  }

  /** Rehydrate a previously persisted snapshot (fixed roots re-seeded anyway). */
  load(map: Record<string, string>): void {
    for (const [cid, uuid] of Object.entries(map)) {
      // 跳过非本环境的固定根（避免 backward 覆盖本环境根映射）
      if (IS_FIREFOX ? CHROME_ROOT_IDS.has(cid) : FF_ROOT_IDS.has(cid)) continue;
      this.forward.set(cid, uuid);
      this.backward.set(uuid, cid);
    }
  }
}

/**
 * Wire chrome events into the coordinator. Returns a disposer that detaches
 * the listeners. A `suppressed` flag (toggled around reverse-apply) makes
 * handlers no-op so our own chrome API calls don't echo back as local ops.
 *
 * `coordinator` may be a lazy getter: in the MV3 service worker it is
 * registered at top level (before login/space selection), so handlers resolve
 * the coordinator lazily and no-op when it is not yet available.
 */
export function captureLocalEvents(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator | (() => SyncCoordinator | null),
  bridge: IdBridge,
  onLocalOp?: () => void,
): { suppressed: { value: boolean } } {
  const suppressed = { value: false };
  const getC = (): SyncCoordinator | null =>
    typeof coordinator === 'function' ? coordinator() : coordinator;

  const onCreated = async (id: string, node: ChromeTreeNode) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    if (fixedRootUuid(id)) return; // never track chrome's own roots
    const mapped = bridge.toUuid(id);
    if (mapped && PROTECTED_UUIDS.has(mapped)) return; // 固定根的动态容器（如 Chromium「书签菜单」）
    const parentUuid = node.parentId ? bridge.toUuid(node.parentId) : null;
    if (!parentUuid) return; // parent not yet mapped; skip (will arrive later)
    const uuid = globalThis.crypto.randomUUID();
    bridge.map(id, uuid);
    const meta: Metadata = { title: node.title, ...(node.url ? { url: node.url } : {}) };
    c.createNodeWithId(uuid, parentUuid, meta);
    onLocalOp?.();
  };

  const onChanged = async (id: string, change: { title: string; url?: string }) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    const uuid = bridge.toUuid(id);
    if (!uuid || PROTECTED_UUIDS.has(uuid)) return;
    const parent = c.replica.getParent(uuid);
    if (!parent) return;
    const current = c.replica.getNodeMeta(uuid) ?? {};
    c.moveNode(uuid, parent, { ...current, title: change.title, url: change.url });
    onLocalOp?.();
  };

  const onMoved = async (
    id: string,
    move: { parentId: string; oldParentId: string; index: number; oldIndex: number },
  ) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    const uuid = bridge.toUuid(id);
    const newParent = move.parentId ? bridge.toUuid(move.parentId) : null;
    if (!uuid || PROTECTED_UUIDS.has(uuid) || !newParent) return;
    const current = c.replica.getNodeMeta(uuid) ?? {};
    c.moveNode(uuid, newParent, { ...current });
    onLocalOp?.();
  };

  const onRemoved = async (id: string) => {
    if (suppressed.value) return;
    const c = getC();
    if (!c) return;
    const uuid = bridge.toUuid(id);
    if (!uuid || PROTECTED_UUIDS.has(uuid)) return;
    c.deleteNode(uuid);
    onLocalOp?.();
  };

  chrome.onCreated.addListener(onCreated);
  chrome.onChanged.addListener(onChanged);
  chrome.onMoved.addListener(onMoved);
  chrome.onRemoved.addListener(onRemoved);

  return { suppressed };
}

/**
 * Reverse-apply CRDT state -> chrome.bookmarks (Phase C-2, wired in sync.js).
 *
 * After pulling remote ops, the local browser tree must be brought in line
 * with the merged CRDT tree. Algorithm (mirrors the reference implementation
 * verified on real Chromium in bookmark-crdt-sync):
 *
 *   1. Reachability: BFS from ROOT_UUID over the visible CRDT tree. Nodes
 *      under a trashed folder are unreachable and must disappear from Chrome.
 *   2. For each reachable user node (BFS order, parents before children),
 *      ensure it exists in Chrome under the right parent at the right index
 *      with the right title/url. Fixed roots ("0"/"1"/"2"/"3") are skipped.
 *   3. For Chrome nodes whose CRDT uuid is unreachable (and mapped), remove.
 *
 * The caller MUST set the event guard (`suppressed`) while this runs, because
 * chrome.create/move/update fire events we do not want to re-ingest as local
 * ops (the event-loop guard).
 */

/** chrome ids we must never create/delete/move/update. */
const PROTECTED_CHROME_IDS = new Set([
  CHROME_ROOT_ID, '1', '2', '3', // Chrome 根
  'root________', 'menu________', 'toolbar_____', 'unfiled_____', 'mobile______', // Firefox 根
]);
/** CRDT uuids we never apply chrome mutations to. */
const PROTECTED_UUIDS = new Set([
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
]);

interface ChromeNodeInfo {
  chromeId: string;
  parentId: string | null;
  title: string;
  url?: string;
  depth: number;
}

/**
 * Best-effort reverse-apply: reconcile the visible CRDT tree onto chrome.
 * Idempotent; safe to run after every pull.
 */
export async function reverseApply(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator,
  bridge: IdBridge,
): Promise<void> {
  // 1. Reachability set + children map from the visible CRDT tree.
  const { reachable, childrenByParent } = buildReachable(coordinator);

  // 2. Flatten current Chrome tree for comparison.
  const chromeNodes = await flattenChromeTree(chrome);

  // 3. Ensure reachable nodes exist (BFS: parents before children).
  await ensureReachableNodes(chrome, bridge, childrenByParent, reachable);

  // 4. Remove Chrome nodes whose CRDT uuid is unreachable (and mapped).
  await removeTrashedNodes(chrome, bridge, reachable, chromeNodes);
}

/** Build the reachable set and a parent -> children map from the CRDT. */
function buildReachable(coordinator: SyncCoordinator): {
  reachable: Set<string>;
  childrenByParent: Map<string, Array<{ child: string; meta: Metadata }>>;
} {
  const childrenByParent = new Map<string, Array<{ child: string; meta: Metadata }>>();
  for (const edge of coordinator.replica.getVisibleTree()) {
    const arr = childrenByParent.get(edge.parent);
    if (arr) arr.push({ child: edge.child, meta: edge.meta });
    else childrenByParent.set(edge.parent, [{ child: edge.child, meta: edge.meta }]);
  }
  // BFS from ROOT_UUID; trashed subtrees are unreachable and dropped.
  const reachable = new Set<string>();
  const queue: string[] = [ROOT_UUID];
  while (queue.length > 0) {
    const u = queue.shift()!;
    if (reachable.has(u)) continue;
    reachable.add(u);
    for (const c of childrenByParent.get(u) ?? []) queue.push(c.child);
  }
  return { reachable, childrenByParent };
}

/** Flatten chrome.getTree() into a chromeId -> info map (with depth). */
async function flattenChromeTree(chrome: ChromeBookmarksAPI): Promise<Map<string, ChromeNodeInfo>> {
  const roots = await chrome.getTree();
  const out = new Map<string, ChromeNodeInfo>();
  const walk = (node: ChromeTreeNode, parentId: string | null, depth: number) => {
    out.set(node.id, {
      chromeId: node.id,
      parentId,
      title: node.title,
      url: node.url,
      depth,
    });
    for (const c of node.children ?? []) walk(c, node.id, depth + 1);
  };
  for (const r of roots) walk(r, null, 0);
  return out;
}

/**
 * Walk reachable nodes in BFS order. For each user node (not a protected
 * root), create it in Chrome if missing, otherwise align parent/index and
 * title/url. Siblings are ordered by fractional position (lexicographic).
 */
async function ensureReachableNodes(
  chrome: ChromeBookmarksAPI,
  bridge: IdBridge,
  childrenByParent: Map<string, Array<{ child: string; meta: Metadata }>>,
  reachable: Set<string>,
): Promise<void> {
  const queue: string[] = [ROOT_UUID];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parentUuid = queue.shift()!;
    if (visited.has(parentUuid)) continue;
    visited.add(parentUuid);

    const kids = childrenByParent.get(parentUuid) ?? [];
    kids.sort((a, b) => {
      const pa = a.meta.position ?? '';
      const pb = b.meta.position ?? '';
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.child < b.child ? -1 : 1;
    });

    for (let i = 0; i < kids.length; i++) {
      const { child: childUuid, meta } = kids[i];
      if (!reachable.has(childUuid)) continue;
      queue.push(childUuid);
      if (PROTECTED_UUIDS.has(childUuid)) continue;

      const parentChromeId = bridge.toChromeId(parentUuid);
      if (!parentChromeId) continue; // parent not yet mapped; skip

      const existingChromeId = bridge.toChromeId(childUuid);
      const title = (meta.title as string) ?? '';
      const url = meta.url as string | undefined;

      if (!existingChromeId) {
        // Create in Chrome (real API takes a single details object).
        // index 必须在 0..当前子节点数 之间，否则 chrome 报 "Index out of bounds"。
        const siblings = await chrome.getChildren(parentChromeId);
        const createIndex = Math.max(0, Math.min(i, siblings.length));
        try {
          const created = await chrome.create({
            parentId: parentChromeId,
            title,
            ...(url !== undefined ? { url } : {}),
            index: createIndex,
          });
          bridge.map(created.id, childUuid);
        } catch (e) {
          // 诊断：持久化 create 入参与错误（真实 Chromium 定位签名问题用）
          try {
            await (globalThis as any).chrome?.storage?.local?.set({
              lastRaError: `create ${e?.message} | parentId=${JSON.stringify(parentChromeId)} title=${JSON.stringify(title)} url=${JSON.stringify(url)} index=${createIndex}`,
            });
          } catch {}
          throw e;
        }
      } else {
        // Align parent/index and metadata. The node may exist in Chrome but
        // under a different parent (remote move) — move it to the target.
        let current = (await chrome.getChildren(parentChromeId)).find((n) => n.id === existingChromeId);
        if (!current || current.parentId !== parentChromeId || current.index !== i) {
          const siblings = await chrome.getChildren(parentChromeId);
          const moveIndex = Math.max(0, Math.min(i, Math.max(0, siblings.length - 1)));
          await chrome.move(existingChromeId, { parentId: parentChromeId, index: moveIndex });
          current = (await chrome.getChildren(parentChromeId)).find((n) => n.id === existingChromeId) ?? current;
        }
        if (current && (current.title !== title || current.url !== url)) {
          await chrome.update(existingChromeId, {
            title,
            ...(url !== undefined ? { url } : {}),
          });
        }
      }
    }
  }
}

/**
 * Remove Chrome nodes whose mapped CRDT uuid is unreachable (i.e. trashed).
 * Only touches nodes that have a uuid mapping; unmapped Chrome nodes (e.g.
 * bookmarks created outside this extension) are left alone to avoid data
 * loss. Deletion is deepest-first so removeTree handles subtrees.
 */
async function removeTrashedNodes(
  chrome: ChromeBookmarksAPI,
  bridge: IdBridge,
  reachable: Set<string>,
  chromeNodes: Map<string, ChromeNodeInfo>,
): Promise<void> {
  const toDelete: ChromeNodeInfo[] = [];
  for (const info of chromeNodes.values()) {
    if (PROTECTED_CHROME_IDS.has(info.chromeId)) continue;
    const uuid = bridge.toUuid(info.chromeId);
    if (uuid === null) continue; // unmapped: leave alone
    if (!reachable.has(uuid)) toDelete.push(info);
  }
  toDelete.sort((a, b) => b.depth - a.depth); // deepest first
  for (const info of toDelete) {
    if (!chromeNodes.has(info.chromeId)) continue; // already removed via ancestor
    await chrome.removeTree(info.chromeId);
    chromeNodes.delete(info.chromeId);
  }
}
