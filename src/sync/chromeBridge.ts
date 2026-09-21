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
 * MENU_UUID 在 Chromium 端是动态容器（sync.js 按需创建/移除：菜单有内容才
 * 显示「书签菜单」文件夹），事件层把「已映射到固定根的动态 id」当固定根
 * 处理（不产生 CRDT op）。
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
  positionBetween,
} from '../crdt/index.js';
import type { SyncCoordinator } from './syncEngine.js';

/** Minimal chrome.bookmarks surface we depend on (ease of testing). */
export interface ChromeBookmarksAPI {
  getTree(): Promise<ChromeTreeNode[]>;
  get(id: string | string[]): Promise<ChromeTreeNode[]>;
  /** NOTE: 真实 chrome.bookmarks.create 是单对象签名 create(details)。 */
  create(props: {
    parentId: string;
    title?: string;
    url?: string;
    index?: number;
  }): Promise<ChromeTreeNode>;
  move(id: string, moveProps: { parentId: string; index?: number }): Promise<ChromeTreeNode>;
  update(id: string, changes: { title?: string; url?: string }): Promise<ChromeTreeNode>;
  remove(id: string): Promise<void>;
  removeTree(id: string): Promise<void>;
  getChildren(parentId: string): Promise<ChromeTreeNode[]>;
  onCreated: BrowserEvent<[string, ChromeTreeNode]>;
  onChanged: BrowserEvent<[string, { title: string; url?: string }]>;
  onMoved: BrowserEvent<
    [string, { parentId: string; oldParentId: string; index: number; oldIndex: number }]
  >;
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
    case CHROME_ROOT_ID:
      return ROOT_UUID; // Chrome "0"
    case 'root________':
      return ROOT_UUID; // Firefox root
    case '1':
      return BOOKMARKS_BAR_UUID; // Chrome 书签栏
    case 'toolbar_____':
      return BOOKMARKS_BAR_UUID; // Firefox 书签工具栏
    case '2':
      return OTHER_BOOKMARKS_UUID; // Chrome 其他书签
    case 'unfiled_____':
      return OTHER_BOOKMARKS_UUID; // Firefox 其他书签
    case '3':
      return MOBILE_UUID; // Chrome 移动书签
    case 'mobile______':
      return MOBILE_UUID; // Firefox 移动书签
    case 'menu________':
      return MENU_UUID; // Firefox 书签菜单
    default:
      return null;
  }
}

/** 运行环境是否为 Firefox（根 id 体系不同：guid vs 数字）。 */
export const IS_FIREFOX = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

/** 所有固定根 UUID（ROOT 之外 4 个）。 */
export const LANDING_ROOT_UUIDS: ReadonlySet<string> = new Set([
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
]);

/**
 * 本环境原生根（[chromeId, uuid]，首项是根 id）。
 *
 * 设备绑定空间方案下，本机书签树 ≡ 绑定空间，落地区恒为这一组
 * （`IdBridgeOptions.roots` 仅测试用；Chromium 缺失的「书签菜单」容器由
 * sync.js 按需创建）。
 */
export function nativeRootPairs(isFirefox: boolean): Array<[string, string]> {
  return isFirefox
    ? [
        ['root________', ROOT_UUID],
        ['menu________', MENU_UUID],
        ['toolbar_____', BOOKMARKS_BAR_UUID],
        ['unfiled_____', OTHER_BOOKMARKS_UUID],
        ['mobile______', MOBILE_UUID],
      ]
    : [
        [CHROME_ROOT_ID, ROOT_UUID],
        ['1', BOOKMARKS_BAR_UUID],
        ['2', OTHER_BOOKMARKS_UUID],
        ['3', MOBILE_UUID],
      ];
}

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
const CHROME_ROOT_IDS = new Set([CHROME_ROOT_ID, '1', '2', '3']);
const FF_ROOT_IDS = new Set([
  'root________',
  'menu________',
  'toolbar_____',
  'unfiled_____',
  'mobile______',
]);
/**
 * In-memory chromeId <-> uuid map. Persistence (chrome.storage.local
 * `crdt.idmap.<spaceId>`，见 sync.js) owns the durable layer; this cache is
 * warmed at start and written-through.
 *
 * backward 只 seed 本环境的根 id：若 Chrome/Firefox 根都 seed，同一 uuid 的
 * backward 会被后写覆盖（OTHER ← 'unfiled_____' 覆盖 '2'），Chromium 下
 * toChromeId(OTHER) 会返回 Firefox guid → chrome "Bookmark id is invalid."。
 *
 * **一个 IdBridge 实例 = 一个空间的映射表**（`crdt.idmap.<spaceId>` 持久化）。
 * 空间与边界的关系（设备绑定空间方案）：一台设备/一个浏览器资料只绑定**一个**
 * 空间，本机书签树 ≡ 该空间，因此不存在「别的空间的落地区也在本机」——映射表
 * 的作用只是把「本机这一次的 chromeId」对上「该空间的 uuid」，换绑时整表重建。
 */
export interface IdBridgeOptions {
  /** 本空间在本机的落地根（chromeId ↔ 固定根 UUID）；省略 = 本环境原生根。 */
  roots?: ReadonlyArray<readonly [string, string]>;
  /** 该映射表所属的空间（诊断用）。 */
  spaceId?: string;
}

export class IdBridge {
  private forward = new Map<string, string>(); // chromeId -> uuid
  private backward = new Map<string, string>(); // uuid -> chromeId
  /** 本空间落地根：固定不可被 map() 改写（固定根不是用户节点）。 */
  private protectedIds = new Set<string>();
  /** 该映射表所属的空间（未指定时视为单空间模式）。 */
  readonly spaceId?: string;

  constructor(
    private readonly onChange?: () => void,
    opts: IdBridgeOptions = {},
  ) {
    this.spaceId = opts.spaceId;
    if (opts.roots) {
      for (const [cid, uuid] of opts.roots) {
        this.forward.set(cid, uuid);
        this.backward.set(uuid, cid);
      }
    } else {
      for (const [cid, uuid] of ALL_ROOT_PAIRS) this.forward.set(cid, uuid);
      for (const [cid, uuid] of nativeRootPairs(IS_FIREFOX)) {
        this.backward.set(uuid, cid);
      }
    }
    this.protectedIds = new Set(this.forward.keys());
  }

  toUuid(chromeId: string): string | null {
    return this.forward.get(chromeId) ?? null;
  }

  toChromeId(uuid: string): string | null {
    return this.backward.get(uuid) ?? null;
  }

  /** 该 uuid 是否是固定根（ROOT / 书签栏 / 其他书签 / 移动设备 / 书签菜单）。 */
  isLandingRoot(uuid: string): boolean {
    return LANDING_ROOT_UUIDS.has(uuid);
  }

  /**
   * 登记一条映射。
   *
   * 拒绝两种情况：
   *   1. 本空间落地根 chromeId（原生书签栏被改成普通节点后，会被当用户节点
   *      参与捕获与投影，书签栏本身变成一个可被 tombstone 的节点）；
   *   2. 固定根 uuid 已被另一 chromeId 占用（同一空间只能有一块落地）。
   *
   * 顺带裁掉「同一 uuid 的旧 chromeId」——旧实现只覆盖 backward，forward 里
   * 指向已失效 chromeId 的条目会长期残留，一旦 chromeId 被复用（恢复浏览器
   * 配置 / 导入书签备份）就会把新书签误认成旧 uuid（串号）。
   */
  map(chromeId: string, uuid: string): void {
    if (this.protectedIds.has(chromeId)) return;
    const prevCid = this.backward.get(uuid);
    if (prevCid && prevCid !== chromeId) {
      if (!this.protectedIds.has(prevCid)) this.forward.delete(prevCid);
      else return; // 该 uuid 已由落地根占用，不能再被普通节点映射
    }
    this.forward.set(chromeId, uuid);
    this.backward.set(uuid, chromeId);
    this.onChange?.();
  }

  /**
   * 拆除一条映射（两向都删）。
   *
   * 用于：空容器清理、节点被永久删除后的映射回收。旧实现里 sync.js 调用
   * 本方法但 IdBridge 上没有它（只有 UuidMappingStore 有）→ TypeError 被
   * catch 吞掉，映射与 `crdt.menuFolderId` 永不清理，且 forward 里指向已
   * 消失 chromeId 的陈旧条目会长期残留，一旦 chromeId 被复用（恢复配置/
   * 导入书签备份）就会把新书签误认成旧 uuid（串号）。
   */
  removeByChromeId(chromeId: string): void {
    const uuid = this.forward.get(chromeId);
    this.forward.delete(chromeId);
    if (uuid && this.backward.get(uuid) === chromeId) this.backward.delete(uuid);
    this.onChange?.();
  }

  /** 按 uuid 拆映射（反向）。 */
  removeByUuid(uuid: string): void {
    const cid = this.backward.get(uuid);
    this.backward.delete(uuid);
    if (cid && this.forward.get(cid) === uuid) this.forward.delete(cid);
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
      // 落地根本身由构造期 seed 决定，不接受持久化覆盖
      if (this.protectedIds.has(cid)) continue;
      this.forward.set(cid, uuid);
      this.backward.set(uuid, cid);
    }
  }
}

/** 兄弟排序（position 字典序，uuid tie-break）——computePosition 与
 *  ensureReachableNodes 共用同一比较器，保证两侧顺序一致。 */
function cmpSibling(a: { id: string; meta: Metadata }, b: { id: string; meta: Metadata }): number {
  const pa = a.meta.position ?? '';
  const pb = b.meta.position ?? '';
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compute the fractional position for a sibling insertion at `chromeIndex`
 * under `parentUuid`, consistent with the ordering used by reverseApply
 * (siblings sorted by `meta.position` lexicographically, uuid tie-break).
 *
 * `selfUuid` is excluded from the sibling list (used when the node already
 * exists under that parent, i.e. local reorder via onMoved). Nodes without a
 * position (pre-fix legacy ops) sort to the front by the empty string.
 *
 * The result is the midpoint between the neighbours that the browser's index
 * implies; with no neighbours at all it returns a neutral middle key.
 */
export function computePosition(
  coordinator: SyncCoordinator,
  parentUuid: string,
  chromeIndex: number,
  selfUuid: string | null,
): string | null {
  const siblings = coordinator.replica.getChildren(parentUuid).filter((n) => n.id !== selfUuid);
  // 导入风暴快路径：追加到末尾（index ≥ 现有 CRDT 兄弟数）是批量导入/
  // Chrome 同步灌入的绝对主流。单遍扫出排序末位即可，免去每次事件的
  // O(N log N) 全排序（单文件夹几千书签时整体从 O(N² log N) 降到 O(N²)）。
  if (chromeIndex >= siblings.length && siblings.length > 0) {
    let last = siblings[0];
    for (const n of siblings) if (cmpSibling(n, last) > 0) last = n;
    return positionBetween(last.meta.position ?? null, null);
  }
  const positions = siblings.sort(cmpSibling).map((n) => n.meta.position ?? null);
  const idx = Math.max(0, Math.min(chromeIndex, positions.length));
  const prev = idx > 0 ? positions[idx - 1] : null;
  const next = idx < positions.length ? positions[idx] : null;
  if (prev === null && next === null) return positionBetween(null, null);
  return positionBetween(prev, next);
}

/**
 * Wire chrome events into the coordinator. Returns a disposer that detaches
 * the listeners. A `suppressed` flag (toggled around reverse-apply) makes
 * handlers no-op so our own chrome API calls don't echo back as local ops.
 *
 * `coordinator` may be a lazy getter: in the MV3 service worker it is
 * registered at top level (before login/space selection), so handlers resolve
 * the coordinator lazily and no-op when it is not yet available.
 *
 * The getter may also return a Promise: sync.js uses this for "lazy boot" —
 * when a local event (e.g. a deletion) arrives while the service worker is
 * cold and the coordinator is not yet created, the getter asynchronously
 * boots it (active space + device + key + restored cursor/counter) instead of
 * silently dropping the event. Dropping a deletion there meant the tombstone
 * never reached the server and the next full replay resurrected the node.
 *
 * `bridge` 同样支持 getter：多空间下映射表按空间各一份，事件处理器必须取
 * 「当前活动空间」的那一份（否则会把 A 空间书签的 uuid 用到 B 空间，产生幽灵
 * 节点或漏掉删除墓碑）。
 */
export function captureLocalEvents(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator | (() => SyncCoordinator | null | Promise<SyncCoordinator | null>),
  bridge: IdBridge | (() => IdBridge | null | Promise<IdBridge | null>),
  onLocalOp?: () => void,
): { suppressed: { value: boolean } } {
  let suppressedValue = false;
  // reverseApply 运行期间（suppressed=true）到达的删除事件不能直接丢弃：
  // 同步会把删除前的 CRDT 状态写回 Chrome，覆盖用户删除。入队，抑制结束后
  // 统一补处理（tombstone 照常产生并推送）。
  let pendingRemoved: string[] = [];
  const getC = async (): Promise<SyncCoordinator | null> => {
    const c = typeof coordinator === 'function' ? coordinator() : coordinator;
    return c instanceof Promise ? await c : c;
  };
  const getB = async (): Promise<IdBridge | null> => {
    const b = typeof bridge === 'function' ? bridge() : bridge;
    return b instanceof Promise ? await b : b;
  };

  const handleRemoved = async (id: string, info?: { removedNode: ChromeTreeNode }) => {
    const c = await getC();
    if (!c) return;
    const b = await getB();
    if (!b) return;
    const uuid = b.toUuid(id);
    if (!uuid) return;
    // 书签菜单容器被用户删除：逐个子节点 tombstone（=「清空内容」），容器本体
    // 不产生墓碑——它由 reverseApply 按需重建/恢复。菜单位置保留（Firefox 原生
    // menu________ 根删不掉，且被动使用率极高——地址栏星标默认存这里），只清
    // 内容，实现「清空菜单内容」的跨设备一致删除。
    // 若 tombstone 容器本身，Firefox 菜单会随同步报废：旧内容被清、之后手动
    // 放入的新书签也会被当作不可达节点静默删除。
    if (uuid === MENU_UUID) {
      const tombstoneSubtree = (node: ChromeTreeNode) => {
        for (const child of node.children ?? []) {
          const childUuid = b.toUuid(child.id);
          if (childUuid) {
            c.deleteNode(childUuid);
            onLocalOp?.();
          }
          tombstoneSubtree(child);
        }
      };
      tombstoneSubtree(info?.removedNode ?? { id, title: '' });
      return;
    }
    if (PROTECTED_UUIDS.has(uuid)) return; // 原生根与落地区根删不掉
    c.deleteNode(uuid);
    onLocalOp?.();
  };

  const onRemoved = async (id: string, info: { removedNode: ChromeTreeNode }) => {
    console.log(
      `[bsync] 事件 onRemoved: id=${id} title="${info?.removedNode?.title ?? ''}" url=${info?.removedNode?.url ?? ''} suppressed=${suppressedValue}`,
    );
    if (suppressedValue) {
      pendingRemoved.push(id);
      return;
    }
    await handleRemoved(id, info);
  };

  const onCreated = async (id: string, node: ChromeTreeNode) => {
    console.log(
      `[bsync] 事件 onCreated: id=${id} title="${node.title}" url=${node.url ?? ''} parent=${node.parentId} index=${node.index} suppressed=${suppressed.value}`,
    );
    if (suppressed.value) return;
    const c = await getC();
    if (!c) return;
    const b = await getB();
    if (!b) return;
    if (fixedRootUuid(id)) return; // never track chrome's own roots
    // 已映射 = 重复事件，或与本轮 runSync 的重扫描（captureLocalTree）竞态：
    // captureLocalTree 的树遍历相对事件处理器是原子的（遍历期间无 await，
    // 事件回调排在其后的宏任务里），谁先映射成功另一方都会在这里看到映射
    // 并让路——绝不重映射，否则同一书签会产生两个 CRDT 节点。
    const mapped = b.toUuid(id);
    if (mapped) return;
    const parentUuid = node.parentId ? b.toUuid(node.parentId) : null;
    if (!parentUuid) return; // parent not yet mapped; skip（重扫描兜底补建）
    const uuid = globalThis.crypto.randomUUID();
    b.map(id, uuid);
    const meta: Metadata = { title: node.title, ...(node.url ? { url: node.url } : {}) };
    // 按 Chrome 实际 index 生成 fractional position（顺序层接线：同一父下
    // 兄弟按 position 字典序收敛，修复「同步后按 uuid 重排」问题）
    const pos = computePosition(c, parentUuid, node.index ?? 0, null);
    if (pos !== null) meta.position = pos;
    c.createNodeWithId(uuid, parentUuid, meta);
    onLocalOp?.();
  };

  const onChanged = async (id: string, change: { title: string; url?: string }) => {
    console.log(
      `[bsync] 事件 onChanged: id=${id} title="${change.title}" url=${change.url ?? ''} suppressed=${suppressed.value}`,
    );
    if (suppressed.value) return;
    const c = await getC();
    if (!c) return;
    const b = await getB();
    if (!b) return;
    const uuid = b.toUuid(id);
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
    console.log(
      `[bsync] 事件 onMoved: id=${id} parent=${move.parentId} oldParent=${move.oldParentId} index=${move.index} oldIndex=${move.oldIndex} suppressed=${suppressed.value}`,
    );
    if (suppressed.value) return;
    const c = await getC();
    if (!c) return;
    const b = await getB();
    if (!b) return;
    const uuid = b.toUuid(id);
    const newParent = move.parentId ? b.toUuid(move.parentId) : null;
    if (!uuid || PROTECTED_UUIDS.has(uuid) || !newParent) return;
    const current = c.replica.getNodeMeta(uuid) ?? {};
    // 拖拽/移动：按 Chrome 新 index 重算 position（旧父中剩余兄弟相对顺序
    // 不变，无需处理；新父下按新 position 收敛）
    const pos = computePosition(c, newParent, move.index ?? 0, uuid);
    c.moveNode(uuid, newParent, { ...current, ...(pos !== null ? { position: pos } : {}) });
    onLocalOp?.();
  };

  chrome.onCreated.addListener(onCreated);
  chrome.onChanged.addListener(onChanged);
  chrome.onMoved.addListener(onMoved);
  chrome.onRemoved.addListener(onRemoved);

  // 访问器对象：sync.js 置 suppressed=false（reverseApply 结束）时自动补处理
  // 同步期间积压的删除事件。
  const suppressed = {
    get value(): boolean {
      return suppressedValue;
    },
    set value(v: boolean) {
      suppressedValue = v;
      if (!v && pendingRemoved.length > 0) {
        const batch = pendingRemoved;
        pendingRemoved = [];
        for (const id of batch) void handleRemoved(id);
      }
    },
  };

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
 *
 * 性能：chrome 侧树形状来自单次 chrome.getTree()（flattenChromeTree 顺带
 * 产出 childrenByParent 索引），ensureReachableNodes 只查索引并在
 * create/move 时同步维护——替代原先每节点至多 3 次 chrome.getChildren
 * 往返（几千书签的同步从几千次 API 往返降到 1 次 getTree）。
 */

/** chrome ids we must never create/delete/move/update. */
const PROTECTED_CHROME_IDS = new Set([
  CHROME_ROOT_ID,
  '1',
  '2',
  '3', // Chrome 根
  'root________',
  'menu________',
  'toolbar_____',
  'unfiled_____',
  'mobile______', // Firefox 根
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

  // 2. Flatten current Chrome tree for comparison（同一次 getTree 顺带产出
  //    chrome 侧父子索引，供 ensureReachableNodes 查询与维护）。
  const { nodes: chromeNodes, childrenByParent: chromeChildren } = await flattenChromeTree(chrome);

  // 3. Ensure reachable nodes exist (BFS: parents before children).
  await ensureReachableNodes(
    chrome,
    bridge,
    childrenByParent,
    reachable,
    chromeNodes,
    chromeChildren,
  );

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

/** Flatten chrome.getTree() into a chromeId -> info map（含深度），
 *  顺带产出 chromeId -> 有序子节点数组的父子索引（getTree 顺序即 index 序）。 */
async function flattenChromeTree(chrome: ChromeBookmarksAPI): Promise<{
  nodes: Map<string, ChromeNodeInfo>;
  childrenByParent: Map<string, ChromeTreeNode[]>;
}> {
  const roots = await chrome.getTree();
  const nodes = new Map<string, ChromeNodeInfo>();
  const childrenByParent = new Map<string, ChromeTreeNode[]>();
  const walk = (node: ChromeTreeNode, parentId: string | null, depth: number) => {
    nodes.set(node.id, {
      chromeId: node.id,
      parentId,
      title: node.title,
      url: node.url,
      depth,
    });
    if (parentId !== null) {
      const arr = childrenByParent.get(parentId);
      if (arr) arr.push(node);
      else childrenByParent.set(parentId, [node]);
    }
    for (const c of node.children ?? []) walk(c, node.id, depth + 1);
  };
  for (const r of roots) walk(r, null, 0);
  return { nodes, childrenByParent };
}

/**
 * Walk reachable nodes in BFS order. For each user node (not a landing root),
 * create it in Chrome if missing, otherwise align parent/index and title/url.
 * Siblings are ordered by fractional position (lexicographic).
 *
 * chrome 侧树形状查询全部走 chromeChildren 索引（flattenChromeTree 产出），
 * create/move 后立即维护索引，保证同一轮 pass 内后续兄弟看到一致的树。
 *
 * 多空间的两处关键差异：
 *   1. **落地根不可动**：固定根 uuid（ROOT/BAR/OTHER/MOBILE/MENU）指向的
 *      chrome 节点（原生根或容器 + 容器内子文件夹）只做「按需创建」，不参与
 *      move/update——原生根不是用户的节点，容器也不是。
 *   2. **外来兄弟感知排序**：默认空间的书签栏里还挂着别的空间的容器文件夹，
 *      它们不属于本空间的兄弟序。index 计算只在「本空间自有兄弟」里数位，
 *      外来节点一律被推向后方，避免每轮同步把容器来回挪动（churn）。
 */
async function ensureReachableNodes(
  chrome: ChromeBookmarksAPI,
  bridge: IdBridge,
  childrenByParent: Map<string, Array<{ child: string; meta: Metadata }>>,
  reachable: Set<string>,
  chromeNodes: Map<string, ChromeNodeInfo>,
  chromeChildren: Map<string, ChromeTreeNode[]>,
): Promise<void> {
  const queue: string[] = [ROOT_UUID];
  const visited = new Set<string>();
  const chromeIds = new Set(chromeNodes.keys());
  /** chrome 侧某父下的全部子节点（活引用：create/move 后就地维护）。 */
  const siblingsOf = (parentId: string): ChromeTreeNode[] => chromeChildren.get(parentId) ?? [];
  /**
   * 目标绝对 index：把节点放到父下第 i 位。
   * 参考列表是**排除自身**后的列表（chrome.move 的 index 是移动后的位置）。
   */
  const absoluteIndexFor = (parentId: string, i: number, selfId?: string): number => {
    const all = siblingsOf(parentId).filter((n) => n.id !== selfId);
    const anchor = all[i];
    if (anchor) return all.findIndex((n) => n.id === anchor.id);
    return Math.min(i, all.length);
  };

  /**
   * 该 chromeId 是否落在本空间的落地区内（落地根自身或其后代）。
   *
   * 用于剪断「跨空间拖拽」造成的拉锯：用户把原生书签栏里的书签拖进别的空间
   * 的容器后，本空间的映射仍指向它——若不撤销，两个空间会在每轮同步里把它
   * 来回搬（A 搬回书签栏、B 搬回容器）。撤销映射后按「未创建」重建，语义上
   * 等价于「拖拽 = 复制一份到那个空间」。
   */
  const landingChromeId = bridge.toChromeId(ROOT_UUID);
  const underLanding = (chromeId: string): boolean => {
    if (!landingChromeId) return true;
    const seen = new Set<string>();
    let cur: string | null = chromeId;
    while (cur && !seen.has(cur)) {
      if (cur === landingChromeId) return true;
      seen.add(cur);
      cur = chromeNodes.get(cur)?.parentId ?? null;
    }
    return false;
  };

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

      if (bridge.isLandingRoot(childUuid)) {
        // 固定根本身不是用户节点，永不 create/move/update。原生根恒已落地；
        // Chromium 缺失的「书签菜单」容器由 sync.js 按需创建。
        continue;
      }

      const parentChromeId = bridge.toChromeId(parentUuid);
      if (!parentChromeId) continue; // parent not yet mapped; skip

      const existingChromeId = bridge.toChromeId(childUuid);
      const title = (meta.title as string) ?? '';
      const url = meta.url as string | undefined;

      const createInChrome = async (): Promise<void> => {
        // index 必须在 0..当前子节点数 之间，否则 chrome 报 "Index out of bounds"。
        const siblings = siblingsOf(parentChromeId);
        const createIndex = Math.max(
          0,
          Math.min(absoluteIndexFor(parentChromeId, i), siblings.length),
        );
        let created: ChromeTreeNode;
        try {
          created = await chrome.create({
            parentId: parentChromeId,
            title,
            ...(url !== undefined ? { url } : {}),
            index: createIndex,
          });
        } catch (e) {
          // 诊断：持久化 create 入参与错误（真实 Chromium 定位签名问题用）
          try {
            await (globalThis as any).chrome?.storage?.local?.set({
              lastRaError: `create ${(e as Error)?.message ?? e} | parentId=${JSON.stringify(parentChromeId)} title=${JSON.stringify(title)} url=${JSON.stringify(url)} index=${createIndex}`,
            });
          } catch {}
          throw e;
        }
        siblings.splice(Math.min(createIndex, siblings.length), 0, created);
        chromeNodes.set(created.id, {
          chromeId: created.id,
          parentId: parentChromeId,
          title: created.title,
          url: created.url,
          depth: (chromeNodes.get(parentChromeId)?.depth ?? 0) + 1,
        });
        chromeIds.add(created.id);
        bridge.map(created.id, childUuid);
      };

      if (!existingChromeId) {
        // Create in Chrome (real API takes a single details object).
        await createInChrome();
      } else {
        // Chrome 中节点已不存在（外部删除 / 级联删除，如删除整个父文件夹），
        // 或已被搬到本空间落地区之外（跨空间拖拽），但映射仍在：按“未创建”
        // 重新创建，而不是 move 一个不属于本空间的 id。
        if (!chromeIds.has(existingChromeId) || !underLanding(existingChromeId)) {
          bridge.removeByChromeId(existingChromeId);
          await createInChrome();
          continue;
        }
        // Align parent/index and metadata. The node may exist in Chrome but
        // under a different parent (remote move) — move it to the target.
        // index 比较：位次一致就不 move（避免顺序已对时的无谓 API 往返）。
        const current = siblingsOf(parentChromeId).find((n) => n.id === existingChromeId);
        const at = siblingsOf(parentChromeId).findIndex((n) => n.id === existingChromeId);
        if (!current || current.parentId !== parentChromeId || at !== i) {
          // 从旧父的索引数组中摘除（若在），再插入新父的目标位置。
          const oldParentId = current?.parentId ?? chromeNodes.get(existingChromeId)?.parentId;
          if (oldParentId && oldParentId !== parentChromeId) {
            const oldSiblings = siblingsOf(oldParentId);
            const atOld = oldSiblings.findIndex((n) => n.id === existingChromeId);
            if (atOld >= 0) oldSiblings.splice(atOld, 1);
          }
          const siblings = siblingsOf(parentChromeId);
          const moveIndex = Math.max(
            0,
            Math.min(absoluteIndexFor(parentChromeId, i, existingChromeId), siblings.length),
          );
          const moved = await chrome.move(existingChromeId, {
            parentId: parentChromeId,
            index: moveIndex,
          });
          const atNow = siblings.findIndex((n) => n.id === existingChromeId);
          if (atNow >= 0) siblings.splice(atNow, 1);
          siblings.splice(Math.min(moveIndex, siblings.length), 0, moved);
          const info = chromeNodes.get(existingChromeId);
          if (info) {
            info.parentId = parentChromeId;
            info.depth = (chromeNodes.get(parentChromeId)?.depth ?? 0) + 1;
          }
        }
        const after = siblingsOf(parentChromeId).find((n) => n.id === existingChromeId);
        if (after && (after.title !== title || after.url !== url)) {
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
 * 重扫描本机 chrome 书签树：为所有未映射节点补建 MoveOp（幂等，返回补建数）。
 *
 * 由 sync.js 在每轮 runSync 的 pull 之后调用（替代旧「仅云端为空时播种」）。
 * 每轮执行让以下场景的孤儿书签都能被捕获（旧实现下它们永不同步）：
 *   - 批量导入 / Chrome 同步灌入过程中浏览器被关闭（事件与映射都没落盘）
 *   - 事件被静默丢弃（父节点未映射、未登录/未设口令窗口、SW 冷启动竞态）
 *   - 第二台设备本地已有书签而云端非空（「并集合并」语义的真正落实）
 *
 * `rootChromeId`（多空间）：只从本空间的落地根起走。
 *   - 默认空间 = 原生根 "0" / `root________`；
 *   - 容器空间 = 容器文件夹。容器外的任何书签都不属于本空间，一律不捕获
 *     ——否则切空间会把原生书签栏里的内容当「未映射」吸进容器空间。
 * 省略时退回旧行为（遍历整棵树），仅供单空间调用方/测试使用。
 *
 * 已映射节点跳过（继续走子树），未映射节点生成 uuid 并 createNodeWithId。
 * 遍历相对 chrome 事件处理器是原子的：getTree 之后整个 walk 无外部 await，
 * 事件回调（宏任务）不会插进遍历中间；onCreated 侧的「已映射即让路」守卫
 * 保证先后到达都不会产生重复节点。
 */
export async function captureLocalTree(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator,
  bridge: IdBridge,
  rootChromeId?: string,
): Promise<number> {
  const tree = (await chrome.getTree()) ?? [];
  const roots: ChromeTreeNode[] = [];
  if (rootChromeId) {
    const node = findChromeNode(tree, rootChromeId);
    if (!node) return 0; // 取不到根（浏览器异常）：本轮不捕获，下次同步再收敛
    roots.push(node);
  } else {
    roots.push(...tree);
  }
  let captured = 0;
  const walk = async (node: ChromeTreeNode, parentUuid: string): Promise<void> => {
    const existing = bridge.toUuid(node.id);
    if (existing) {
      // 固定根（Chrome "0".."3" / Firefox 根）与已映射用户节点直接续走
      // 子树：不产生新 op
      for (const child of node.children ?? []) await walk(child, existing);
      return;
    }
    const uuid = globalThis.crypto.randomUUID();
    bridge.map(node.id, uuid);
    const meta: Metadata = { title: node.title, ...(node.url ? { url: node.url } : {}) };
    // 按 Chrome 实际 index 生成 fractional position（与 onCreated 一致：
    // 捕获也保留用户已有的顺序）
    const pos = computePosition(coordinator, parentUuid, node.index ?? 0, null);
    if (pos !== null) meta.position = pos;
    coordinator.createNodeWithId(uuid, parentUuid, meta);
    captured++;
    for (const child of node.children ?? []) await walk(child, uuid);
  };
  for (const root of roots) await walk(root, ROOT_UUID);
  return captured;
}

/** 在 chrome 树里按 id 找节点（含子树）。 */
function findChromeNode(nodes: ChromeTreeNode[], id: string): ChromeTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findChromeNode(n.children ?? [], id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Remove Chrome nodes whose mapped CRDT uuid is unreachable (i.e. trashed).
 * Only touches nodes that have a uuid mapping; unmapped Chrome nodes (e.g.
 * bookmarks created outside this extension) are left alone to avoid data
 * loss. Deletion is deepest-first so removeTree handles subtrees.
 *
 * 护栏：映射按空间隔离（bridge per space）——不属于本空间的节点在本空间
 * 「无映射」，自然落进 `uuid === null → leave alone`，不会被误删。
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
