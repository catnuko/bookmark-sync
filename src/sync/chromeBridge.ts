/**
 * Chrome bookmarks <-> Move-CRDT bridge (Phase C-2).
 *
 * This is the ONLY module that touches chrome.bookmarks. It adapts:
 *   local chrome events            -> coordinator.create/move/delete
 *   remote CRDT state (after pull)  -> reverse-applied to chrome.bookmarks
 *
 * Root topology (fixed UUIDs; chromeId 由 rootResolver 每轮解析):
 *   __root__
 *     └─ ROOT_UUID                    (chrome root id "0")
 *          ├─ BOOKMARKS_BAR_UUID      (chrome "1", folderType 'bookmarks-bar')
 *          ├─ OTHER_BOOKMARKS_UUID    (chrome "2", folderType 'other')
 *          ├─ MOBILE_UUID             (chrome "3", folderType 'mobile')
 *          ├─ MENU_UUID               (Firefox "menu________" 书签菜单；
 *          │                           Chromium 端 = bsync 自动管理的
 *          │                           「书签菜单」文件夹，动态 chromeId)
 *          ├─ ACCOUNT_BOOKMARKS_BAR_UUID    (账号书签栏, syncing=true)
 *          ├─ ACCOUNT_OTHER_BOOKMARKS_UUID  (账号其他书签, syncing=true)
 *          └─ ACCOUNT_MOBILE_UUID           (账号移动设备书签, syncing=true)
 *
 * 后三个是 Chrome 2025-06 双子树引入的账号（syncing）子树，与本地根**并列**
 * （不是 alias），chromeId 动态：见 src/sync/rootResolver.ts。
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
  ACCOUNT_BOOKMARKS_BAR_UUID,
  ACCOUNT_OTHER_BOOKMARKS_UUID,
  ACCOUNT_MOBILE_UUID,
  CHROME_ROOT_ID,
  positionBetween,
} from '../crdt/index.js';
import type { SyncCoordinator } from './syncEngine.js';
import { contentKey } from './contentFingerprint.js';

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
  /**
   * Chrome 2025-06 双子树标记：true = 同步（账号）子树，false = 非同步（本地）
   * 子树。官方文档：https://developer.chrome.com/blog/bookmarks-sync-changes
   * Chrome < 134 / Firefox 上为 undefined。
   */
  syncing?: boolean;
}

/**
 * chromeId -> fixed root UUID, or null for ordinary nodes.
 * 跨浏览器根 id：Chrome 用数字 "0"/"1"/"2"/"3"，Firefox 用 guid
 * （root________ / menu________ / toolbar_____ / unfiled_____ / mobile______）。
 * Firefox 的 menu________（书签菜单）映射 MENU_UUID（P3 后参与同步）。
 *
 * ⚠ 这是**静态回退表**，只在节点没有 `folderType` 时使用（Chrome < 134 /
 * Firefox）。Chrome 134+ 必须走 src/sync/rootResolver.ts 按 folderType 认根
 * —— 官方明说 id 不固定，且双子树下账号根与本地根同名不同 id。
 */
export function fixedRootUuid(chromeId: string): string | null {
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

/**
 * 所有固定根 UUID：本地 4 个（含 ROOT）+ 账号（syncing）子树 3 个。
 *
 * 账号根是 Chrome 2025-06 双子树引入的第二棵树，chromeId 动态、由
 * src/sync/rootResolver.ts 解析。它们在 CRDT 里与本地根**并列**，因此
 * 「不是落地根」= 「浏览器内部永久文件夹（受管书签 / Firefox tags）」。
 */
export const LANDING_ROOT_UUIDS: ReadonlySet<string> = new Set([
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
  ACCOUNT_BOOKMARKS_BAR_UUID,
  ACCOUNT_OTHER_BOOKMARKS_UUID,
  ACCOUNT_MOBILE_UUID,
]);

/**
 * folderType → 本地（非同步）子树固定根。rootResolver 按 `syncing:false` 认根。
 * 放在这里（而非 rootResolver）是为了让事件桥也能用同一张表识别「真账号根出现」
 * —— 事件桥不能 import rootResolver（后者反过来 import 本文件，会成环）。
 */
export const LOCAL_ROOT_BY_FOLDER_TYPE: Readonly<Record<string, string>> = {
  'bookmarks-bar': BOOKMARKS_BAR_UUID,
  other: OTHER_BOOKMARKS_UUID,
  mobile: MOBILE_UUID,
};

/** folderType → 账号（syncing）子树固定根。rootResolver 按 `syncing:true` 认根。 */
export const ACCOUNT_ROOT_BY_FOLDER_TYPE: Readonly<Record<string, string>> = {
  'bookmarks-bar': ACCOUNT_BOOKMARKS_BAR_UUID,
  other: ACCOUNT_OTHER_BOOKMARKS_UUID,
  mobile: ACCOUNT_MOBILE_UUID,
};

/**
 * 本环境**本地（非同步）**原生根（[chromeId, uuid]，首项是根 id）。
 *
 * ⚠ 只含本地根。账号（syncing）子树的根 chromeId 是动态的，由
 * src/sync/rootResolver.ts 每轮从 getTree() 解析，**不能**写进静态表。
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
 * 本环境的**原生根** chromeId（本地根 / Firefox 原生根）。
 *
 * 双子树下，登录且本地子树为空时本地根会被 Chrome 隐藏 —— 于是它不在
 * `getTree()`、不在 rootResolver 的 pairs 里、也不在 `protectedIds` 里。
 * 但「原生根被隐藏」≠「回退占位」：前者是浏览器的真实根，后者才是 bsync
 * 在「其他书签」下建的占位文件夹（动态 chromeId）。凡是本集合里的 chromeId
 * 都**不能**被登记为回退，否则 `captureLocalTree` 的 walk 会按
 * `isFallbackChromeId` 把整棵本地子树跳过（2026-10-02 真机实测：登录后
 * 本地根被隐藏 → load 把 '1'/'2' 记成回退 → 登出后本地书签永不捕获）。
 */
const NATIVE_ROOT_IDS: ReadonlySet<string> = IS_FIREFOX ? FF_ROOT_IDS : CHROME_ROOT_IDS;
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
  /**
   * 本空间**回退文件夹**记录：落地根 uuid -> bsync 建的占位文件夹 chromeId。
   *
   * 未登录（或账号根被隐藏）时账号子树没有真实落地根，`ensureRootFallback`
   * 会在「其他书签」下建一个同名文件夹承载它。登录后真账号根出现 → 这份回退
   * 必须退休（否则同一 CRDT 子树在本机有两份 chrome 表示 → 重复捕获）。
   * 记录让「回退」从结构上可识别，不靠标题 / 位置猜测。
   */
  private fallbacks = new Map<string, string>(); // landing uuid -> fallback chromeId
  private fallbackChromeIds = new Set<string>();
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

  /** 该 uuid 是否是固定根（本地根 / 账号根 / 书签菜单）。 */
  isLandingRoot(uuid: string): boolean {
    return LANDING_ROOT_UUIDS.has(uuid);
  }

  /**
   * 该 chromeId 是否是本环境的固定根（含账号根与动态菜单容器）。
   *
   * 事件层用它代替旧的 `fixedRootUuid(id)` 判断 —— 账号根的 chromeId 是动态
   * 的，静态表认不出来；而构造期解析出的 roots 里已经包含它们。
   */
  isProtectedChromeId(chromeId: string): boolean {
    return this.protectedIds.has(chromeId);
  }

  /** 该 chromeId 是否是本空间某个落地根的**回退文件夹**（bsync 建的占位）。 */
  isFallbackChromeId(chromeId: string): boolean {
    return this.fallbackChromeIds.has(chromeId);
  }

  /** 回退文件夹代表的落地根 uuid（不是回退则 null）。 */
  fallbackRootOf(chromeId: string): string | null {
    for (const [u, cid] of this.fallbacks) if (cid === chromeId) return u;
    return null;
  }

  /** 落地根 uuid 当前的回退文件夹 chromeId（无则 null）。 */
  fallbackFor(uuid: string): string | null {
    return this.fallbacks.get(uuid) ?? null;
  }

  /** 全部回退记录（退休流程用）。 */
  fallbackEntries(): Array<[string, string]> {
    return [...this.fallbacks.entries()];
  }

  /** 登记一条回退记录（同一落地根只保留最新一个）。 */
  markFallback(uuid: string, chromeId: string): void {
    // 原生根不是回退占位（见 NATIVE_ROOT_IDS 注释）：拒绝登记，避免污染
    // fallbackChromeIds 让 walk 跳过整棵本地子树。
    if (NATIVE_ROOT_IDS.has(chromeId)) return;
    const prev = this.fallbacks.get(uuid);
    if (prev === chromeId) return;
    if (prev) this.fallbackChromeIds.delete(prev);
    this.fallbacks.set(uuid, chromeId);
    this.fallbackChromeIds.add(chromeId);
    this.onChange?.();
  }

  /** 清除一条回退记录（回退文件夹已退休 / 消失）。 */
  clearFallback(uuid: string): void {
    const prev = this.fallbacks.get(uuid);
    if (!prev) return;
    this.fallbackChromeIds.delete(prev);
    this.fallbacks.delete(uuid);
    this.onChange?.();
  }

  /** 从持久化快照恢复回退记录（构造后调用）。 */
  loadFallbacks(map: Record<string, string>): void {
    for (const [u, cid] of Object.entries(map)) {
      // 原生根 chromeId 不可能是 bsync 建的回退占位；旧版本在「登录后本地根
      // 被隐藏」时会把 '1'/'2'/'3' 误记进来，这里过滤以自愈已污染的持久化记录。
      if (NATIVE_ROOT_IDS.has(cid)) continue;
      if (this.fallbacks.get(u) === cid) continue;
      const prev = this.fallbacks.get(u);
      if (prev) this.fallbackChromeIds.delete(prev);
      this.fallbacks.set(u, cid);
      this.fallbackChromeIds.add(cid);
    }
  }

  /** 持久化回退记录（landing uuid -> chromeId）。 */
  fallbackSnapshot(): Record<string, string> {
    return Object.fromEntries(this.fallbacks);
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
    // 该 chromeId 若是某落地根的回退文件夹，记录一并清除（文件夹已不存在）。
    if (this.fallbackChromeIds.has(chromeId)) {
      for (const [u, cid] of this.fallbacks) if (cid === chromeId) this.fallbacks.delete(u);
      this.fallbackChromeIds.delete(chromeId);
    }
    this.onChange?.();
  }

  /** 按 uuid 拆映射（反向）。 */
  removeByUuid(uuid: string): void {
    const cid = this.backward.get(uuid);
    this.backward.delete(uuid);
    if (cid && this.forward.get(cid) === uuid) this.forward.delete(cid);
    const fb = this.fallbacks.get(uuid);
    if (fb) {
      this.fallbackChromeIds.delete(fb);
      this.fallbacks.delete(uuid);
    }
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
      // 落地根：本轮从 getTree() 解析出的 seed 才是权威。
      //   - 已 seed（真根在）→ 丢弃这条持久化映射（陈旧回退），记为回退待退休；
      //   - 未 seed（真根缺席）→ 这条就是「回退落地」，**保留**它并记为回退，
      //     否则每轮重建都会在「其他书签」下再建一个新的回退文件夹
      //     （2026-10-01 真机实测：升级后账号根缺席时凭空多出一套空账号文件夹，
      //      旧回退被重新捕获成两个新 CRDT 节点 → 云端多出两个空文件夹）。
      // MENU_UUID 例外：Chromium 端的「书签菜单」容器本来就是动态映射的
      // （sync.js 按需创建），必须保留。
      if (LANDING_ROOT_UUIDS.has(uuid) && uuid !== MENU_UUID) {
        // 原生根（本地根被 Chrome 隐藏时不在 pairs/protectedIds 里）不是回退
        // 文件夹 —— 只有 bsync 建的占位（动态 chromeId）才是。旧实现把「未
        // seed 的落地根映射」一律记成回退，于是登录后本地根被隐藏时把
        // '1'/'2'/'3' 记成回退；登出后本地根重新可见，walk 会因
        // isFallbackChromeId 跳过整棵本地子树（本地书签永不捕获）。
        if (NATIVE_ROOT_IDS.has(cid)) continue;
        const prev = this.fallbacks.get(uuid);
        if (prev && prev !== cid) this.fallbackChromeIds.delete(prev);
        this.fallbacks.set(uuid, cid);
        this.fallbackChromeIds.add(cid);
        if (this.backward.has(uuid)) continue; // 已 seed：真根胜出，丢弃陈旧回退映射
      }
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
/**
 * 事件桥的可选钩子（由 sync.js 接线）。
 *
 * - `onAnyEvent`：每个 chrome 书签事件到达即触发（含被抑制的回写事件）。用于
 *   「静默去抖」—— 登录态切换时 Chrome 会连续灌入账号子树，等事件静默后再收敛，
 *   避免在拉取中途 reverseApply 造出重复节点。
 * - `onRealRootAppeared`：真账号根（syncing 子树）出现、且该落地根当前仍由回退
 *   文件夹代表时触发，参数是该落地根 uuid 与真根 chromeId。官方建议用生命周期
 *   事件处理双子树变化：https://developer.chrome.com/blog/bookmarks-sync-changes
 */
export interface CaptureEventHooks {
  onAnyEvent?: () => void;
  onRealRootAppeared?: (landingUuid: string, chromeId: string) => void;
}

export function captureLocalEvents(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator | (() => SyncCoordinator | null | Promise<SyncCoordinator | null>),
  bridge: IdBridge | (() => IdBridge | null | Promise<IdBridge | null>),
  onLocalOp?: () => void,
  hooks?: CaptureEventHooks,
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
    // ★ 本次删除是**插件自己**发起的（removeTrashedNodes 删不可达节点）。
    // 不发墓碑：这类删除反映的是「本机这轮没看到云端内容」，把它固化成墓碑
    // 会在同账号其他设备上真的删掉用户书签 —— 从本机丢数据升级成云端污染
    // （2026-10-04 实测 3562 条 trash op 上云）。消费即出队。
    if (pluginRemovedIds.delete(id)) return;
    c.deleteNode(uuid);
    onLocalOp?.();
  };

  const onRemoved = async (id: string, info: { removedNode: ChromeTreeNode }) => {
    console.log(
      `[bsync] 事件 onRemoved: id=${id} title="${info?.removedNode?.title ?? ''}" url=${info?.removedNode?.url ?? ''} suppressed=${suppressedValue}`,
    );
    hooks?.onAnyEvent?.();
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
    hooks?.onAnyEvent?.();
    if (suppressed.value) return;
    const c = await getC();
    if (!c) return;
    const b = await getB();
    if (!b) return;
    // 真账号根出现（登录态切换）：Chrome 从 Google 拉回账号子树时，账号根作为
    // 浏览器根的直接子节点被创建。若该落地根当前仍由回退文件夹代表，说明这是
    // 「回退 → 真根」的切换，需要尽快收敛（退休回退 + 内容认领）。此处**只上报**，
    // 由 sync.js 安排一次静默去抖后的同步 —— 绝不能在此刻直接同步：拉取中途
    // reverseApply 会给「Chrome 尚未拉回的内容」在本机造出节点，随后被 onCreated
    // 当新节点捕获 → 永久 CRDT 重复。
    // ⚠ 必须放在 getC()/getB() 之后：SW 冷启动时 _activeBridge 还是 null，
    // getC() 才会 boot coordinator 并建桥（bootCoordinatorForEvent →
    // ensureActiveBridge）；若先取桥，账号根出现这一个事件会被漏掉（它只出现一次）。
    // 判据用 node.syncing + 浏览器根的直接子节点（官方建议按 folderType +
    // syncing 认根，id 不固定）。
    if (node?.syncing === true && node.parentId && BROWSER_ROOT_IDS.has(node.parentId)) {
      const landing = ACCOUNT_ROOT_BY_FOLDER_TYPE[node.folderType ?? ''];
      if (landing && b.fallbackFor(landing)) hooks?.onRealRootAppeared?.(landing, id);
    }
    // 固定根本身（本地根 / 账号根 / Firefox guid / 动态菜单容器）不建 CRDT 节点
    // ——它们在构造期已预置映射。用 isProtectedChromeId 而非静态 fixedRootUuid：
    // 账号根的 chromeId 是动态的，静态表认不出来。
    if (b.isProtectedChromeId(id)) return;
    // 浏览器根下的**未识别**子节点（受管书签永久文件夹、Firefox tags________）
    // 一律不入 CRDT：它们不是本扩展的固定根拓扑，且 parent 一旦落成
    // ROOT_UUID，别的设备投影时会在根下 create → "Can't modify the root
    // bookmark folders."。判据与 captureLocalTree 的同名守卫一致。
    if (node.parentId && BROWSER_ROOT_IDS.has(node.parentId)) return;
    // 已映射 = 重复事件，或与本轮 runSync 的重扫描（captureLocalTree）竞态：
    // captureLocalTree 的树遍历相对事件处理器是原子的（遍历期间无 await，
    // 事件回调排在其后的宏任务里），谁先映射成功另一方都会在这里看到映射
    // 并让路——绝不重映射，否则同一书签会产生两个 CRDT 节点。
    const mapped = b.toUuid(id);
    if (mapped) return;
    const parentUuid = node.parentId ? b.toUuid(node.parentId) : null;
    if (!parentUuid) return; // parent not yet mapped; skip（重扫描兜底补建）
    // Fix C：replica 缺行时（见 captureLocalTree 同名守卫），本机可能只是没拉到
    // 云端既有内容。此时盲建 = 永久重复；推迟到 replica 补齐后的下一轮
    // captureLocalTree 再认领/新建。新建书签不会丢：本地 Chrome 节点仍在，
    // 下一轮同步（replica 通常已补齐）会捕获它。
    if (c.isReplicaIncomplete) return;
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
    hooks?.onAnyEvent?.();
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
    hooks?.onAnyEvent?.();
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
  ACCOUNT_BOOKMARKS_BAR_UUID,
  ACCOUNT_OTHER_BOOKMARKS_UUID,
  ACCOUNT_MOBILE_UUID,
]);

/**
 * 浏览器**根节点**的 chromeId（Chrome "0" / Firefox `root________`）。
 *
 * 根节点是唯一「不能增删条目」的节点：Chrome 的 `CanBeModified()` 只对
 * `node->is_root()` 返回 false（`bookmarks_function.cc`），任何以它为父的
 * create/move 都会得到 `kModifySpecialError` = "Can't modify the root bookmark
 * folders."。书签栏/其他书签/移动设备（"1"/"2"/"3"）都是**永久节点但不是根**，
 * 在它们下面增删条目完全合法——两者必须区分开。
 */
export const BROWSER_ROOT_IDS: ReadonlySet<string> = new Set([CHROME_ROOT_ID, 'root________']);

/**
 * 回退文件夹的宿主根：**恒为本地「其他书签」**。
 *
 * 选「其他书签」而不是「书签栏」：回退是补救路径，落在一个「杂物筐」里既不
 * 打断用户对书签栏的心智，也不会盖住源设备上真正的书签栏内容；用户拖动一次
 * 就能归位。选中哪个固定根**不需要知道那个内部文件夹到底是哪一类**
 * （Chromium 的 `BookmarkNode::Type` 里账号根与本地根同型、只靠
 * `is_account_node_` 区分，扩展 API 的 `folderType` 也因此分不出来），
 * 这正是这个设计不需要任何外部信息的原因。
 *
 * ★★ 恒为**本地**根、绝不退到账号（syncing）根 —— 这是硬约束，不是偏好。
 * 2026-10-02 真机 + 官方文档核实（一度想退到账号「其他书签」，查证后否掉）：
 *   1. **隐私**：账号子树由 Chrome 自动同步。本地内容落到账号「其他书签」下会被
 *      Chrome **上传到用户的 Google 账号**，而本地书签本该只留本机（官方原文：
 *      *"stored locally on a device will remain local upon sign-in"*）。
 *   2. **翻倍死循环**：上传后其他登录同账号的设备会在**账号子树**里看到它，而
 *      `contentKey` 含 `parentUuid`（contentFingerprint.ts）→ 永远认领不回原
 *      uuid → 被当新节点捕获 → 云端同一书签两份，每台设备都重复显示。
 *   3. 反向（账号内容 → 本地「其他书签」）**没有**这两个问题：本地子树不参与
 *      Chrome 同步，回退文件夹不会被上传，其他设备也看不到它。
 *
 * 「已登录 + 本地为空」时 Chrome **根本不创建**本地根（2026-10-02 真机核实：
 * `get('1'/'2'/'3')` 全部抛 "Can't find bookmark for id."，`getTree()` 只剩账号
 * 根），此时没有宿主根 → 本轮跳过，并把情况报给调用方（见 `onUnplaceableRoot`）。
 * 用户想在本机看到这些本地书签，只需让本地子树非空（登出 Chrome 后新建一个本地
 * 书签）—— 本地根随即出现，下一轮同步就会把内容投影进去。
 */
const FALLBACK_ROOT_UUID: string = OTHER_BOOKMARKS_UUID;

/**
 * 本轮由**插件自己**删掉的 chromeId（`removeTrashedNodes` 登记）。
 *
 * 存在的理由：`onRemoved` 分不清「用户删的」和「插件删的」，而两者后果完全
 * 不同 —— 用户删 → 该发墓碑并 push（跨设备一致删除）；插件删 → **绝不能发**，
 * 否则「本机显示不全」会被固化成云端墓碑，同账号其他设备登录后跟着互删
 * （2026-10-04 实测：某空间 3562 条 trash op 上云、可见树归零）。
 *
 * 为什么不能像 `retireFallbackFolders` 那样「先摘映射再删」：那个函数删的是
 * 回退文件夹（删了本就该消失），而 `removeTrashedNodes` 的删除判据**就是映射**
 * （要靠 `bridge.toUuid` 知道删的是谁），必须留映射到最后一刻。
 *
 * 生命周期：`onRemoved` 消费即 delete；另由 `reverseApply` 入口清理上一轮残留
 * （异常路径可能没走到删除循环）。条目是 chromeId，一轮内的数量级 = 本轮删除数。
 */
const pluginRemovedIds = new Set<string>();

interface ChromeNodeInfo {
  chromeId: string;
  parentId: string | null;
  title: string;
  url?: string;
  depth: number;
}

export interface ReverseApplyOptions {
  /** 回退文件夹的标题（i18n，由调用方传）。 */
  fallbackRootTitle?: string;
  /**
   * 某个落地根在本机**既没有真根、又没有可用的回退宿主根**时回调。
   *
   * 典型且目前唯一的场景：「已登录 + 本地子树为空」—— Chrome 不创建本地根
   * （真机核实 `get('1'/'2'/'3')` 全抛 "Can't find bookmark for id."），于是空间里
   * 挂在本地根下的书签在本机无法落地。调用方据此提示用户（**不要静默**）。
   *
   * @param bookmarkCount 该落地根下**本机看不到的书签条数**（可达子树里带 url 的
   *   节点，文件夹不计 —— 与 used_count 同口径），用于给用户一个具体数字。
   */
  onUnplaceableRoot?: (landingUuid: string, bookmarkCount: number) => void;
  /**
   * ★ 数据安全护栏（**删��路径专用**，与创建路径的 `isReplicaIncomplete` 同源）。
   *
   * 本轮同步期间 replica 缺行（跳过了任何解不开的 op 行）时置位。此时
   * `getVisibleTree()` 只反映**已拉到的部分**，`buildReachable()` 的 BFS 结果
   * 会把「云端有、但本机这轮没拉到」的存量节点误判成「已删除」。
   *
   * 漏这道护栏的后果是**全量数据丢失**：`removeTrashedNodes` 判据只有
   * `!reachable.has(uuid)` 一条，满足就 `chrome.removeTree()` 真删本机节点。
   * 回退文件夹与固定根被 `isLandingRoot` / `PROTECTED_CHROME_IDS` 豁免 →
   * 症状正是「**文件夹还在、内容空了**」（2026-10-04 真机，测试账号）。
   * 下一轮该设备的同类误算会把整棵子树删掉 → Chrome 上「所有书签都没了」。
   *
   * ★ 同一份代码里 `captureLocalTree` / `onCreated` 早就写了
   * `if (coordinator.isReplicaIncomplete) return;`（2026-10-04 的 664-op 重复
   * 事故）。**删除路径当时漏了同一个判断 —— 这是「同族问题只修一半」。**
   * 缺行期间一律**跳过删除**（宁可留脏节点等下一轮收敛，绝不丢数据）。
   */
  skipDeletions?: boolean;
}

/**
 * Best-effort reverse-apply: reconcile the visible CRDT tree onto chrome.
 * Idempotent; safe to run after every pull.
 */
export async function reverseApply(
  chrome: ChromeBookmarksAPI,
  coordinator: SyncCoordinator,
  bridge: IdBridge,
  opts: ReverseApplyOptions = {},
): Promise<void> {
  // 0. 上一轮 `pluginRemovedIds` 残留清理：正常路径每条都被 onRemoved 消费，
  //    但若上一轮在删除循环前抛错（或事件没来），残留会让**下一次**真正的
  //    用户删除被误豁免 → 该发的墓碑不发 → 删除不同步。
  //    只在删除阶段打开的窗口内才有条目，清空时机安全。
  pluginRemovedIds.clear();

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
    // 回退文件夹的名字走 i18n（调用方传），拿不到就用空标题——Chrome 允许，
    // 但调用方（sync.js）一定会传，见 reverseApplyIntoChrome。
    opts.fallbackRootTitle ?? '',
    opts.onUnplaceableRoot,
  );

  // 4. Remove Chrome nodes whose CRDT uuid is unreachable (and mapped).
  //    ★ 数据安全护栏：replica 缺行时 reachable 严重不全，此时「不可达」=
  //    「没拉到」而非「云端已删除」→ 删除会造成全量丢失（2026-10-04 真机事故）。
  //    缺行一律跳过删除，等下一轮 replica 补齐后再收敛。
  if (opts.skipDeletions) {
    console.warn(
      '[bsync] reverseApply: replica 不完整，跳过删除（避免把「没拉到」误判成「已删除」）',
    );
    return;
  }
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
  fallbackRootTitle: string,
  onUnplaceableRoot?: (landingUuid: string, bookmarkCount: number) => void,
): Promise<void> {
  const queue: string[] = [ROOT_UUID];
  const visited = new Set<string>();
  const chromeIds = new Set(chromeNodes.keys());
  /**
   * chrome 侧某父下的全部子节点（**活引用**：create/move 后就地维护）。
   *
   * 关键：空列表也必须**落进 map**。`flattenChromeTree` 只为「当时已有子节点」
   * 的父建键，所以「空父」——新设备上还没内容的书签栏、本轮刚 create 出来的
   * 文件夹——若用 `?? []` 就会拿到一个**一次性数组**：随后的 splice 全写进那个
   * 临时数组并立刻被丢弃，下一个兄弟仍看到空列表 → `absoluteIndexFor` 退化成
   * `Math.min(i, 0) = 0` → **每个子节点都以 index:0 创建，整层顺序倒序**。
   *
   * 实测（2026-09-22 用户反馈「第一次同步位置不对、第二次同步又修复」）：远端
   * `[书签, 文件夹, 文件夹]` 第一遍落地成 `[文件夹, 文件夹, 书签]`；第二遍因节点
   * 已存在而走 move 对齐分支（此时父已有子、键已存在）才被纠正 —— 一个必然被
   * 「第二轮」掩盖的 bug。回归测试：tests/sync/reverseApply.test.ts 的
   * 「空父节点批量创建」用例（配套 mock 必须忠实实现 create 的 index 语义）。
   */
  const siblingsOf = (parentId: string): ChromeTreeNode[] => {
    let arr = chromeChildren.get(parentId);
    if (!arr) {
      arr = [];
      chromeChildren.set(parentId, arr);
    }
    return arr;
  };
  /** uuid → 该节点的 meta（由 childrenByParent 的边反查；用于数书签条数）。 */
  const metaByUuid = new Map<string, Metadata>();
  for (const arr of childrenByParent.values()) {
    for (const e of arr) metaByUuid.set(e.child, e.meta);
  }
  /**
   * 某个落地根下**本机看不到的书签条数**（可达子树里带 url 的节点）。
   * 文件夹不计 —— 与 sync.js 上报 used_count 的口径一致，用户看到的数字才是「书签数」。
   */
  const countBookmarksUnder = (rootUuid: string): number => {
    let n = 0;
    const stack = [rootUuid];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const u = stack.pop()!;
      if (seen.has(u) || !reachable.has(u)) continue;
      seen.add(u);
      const m = metaByUuid.get(u);
      if (!bridge.isLandingRoot(u) && typeof m?.url === 'string' && m.url) n++;
      for (const c of childrenByParent.get(u) ?? []) stack.push(c.child);
    }
    return n;
  };

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

  /**
   * 根下「浏览器内部永久文件夹」的回退落地。
   *
   * 这类节点（Chrome 账号书签 / 受管书签永久文件夹，`BookmarkNode::Type` 与本地
   * 对应根同型、靠 `is_account_node_` 区分；Firefox `tags________`）不可能在
   * 根下被 create —— Chrome 只对 `is_root()` 报
   * "Can't modify the root bookmark folders."。但它们**也不能被整棵跳过**：
   * 挂在其下的整棵子树会因此永久投影不出来。
   *
   * 2026-10-01 线上实测（用户空间 op 数 1509、可见树 988 节点 / 854 书签）：
   * 跳过守卫让 977 个节点（849 书签 + 128 文件夹）一个都没落地，新设备上
   * 「同步成功但书签不出现」。
   *
   * 两条路径，都**不会**在根下 create：
   *   1. 本机已有映射且节点还在（= 当初捕获它的那台设备）→ 直接沿用那个
   *      chrome 节点当父。一个 move 都不发，源设备的 Chrome 树保持原样
   *      （账号书签仍是账号书签，不会被搬出 Google 账号）。
   *   2. 本机没有映射（新设备 / 换过空间）→ 在回退固定根（其他书签）下建一个
   *      同名文件夹并把该 uuid 映射上去，子树照常投影。
   *
   * 映射到同一个 uuid 后，两条路径对 CRDT 是等价的（同一个节点，各设备各自的
   * 落地形态），因此不会产生 op，也不会在设备之间打架。
   */
  const ensureRootFallback = async (uuid: string, meta: Metadata): Promise<void> => {
    const existing = bridge.toChromeId(uuid);
    if (existing && chromeIds.has(existing)) {
      // 路径 1：沿用。若这是落地根，确保回退记录在（跨 SW 重建 / 迁移场景）。
      if (bridge.isLandingRoot(uuid) && bridge.fallbackFor(uuid) !== existing) {
        bridge.markFallback(uuid, existing);
      }
      return;
    }
    if (existing) bridge.removeByChromeId(existing); // 映射陈旧（节点已被删）

    // 宿主根必须在**本机 chrome 树里**。只看 toChromeId 非空不够 —— 「已登录 +
    // 本地为空」时 Chrome 不创建本地根，而映射可能还指着那个已不存在的节点，
    // 拿它当父会直接抛 "Can't find bookmark for id."。
    const parentChromeId = bridge.toChromeId(FALLBACK_ROOT_UUID);
    if (!parentChromeId || !chromeIds.has(parentChromeId)) {
      // 没有宿主根 → 这个落地根下的内容在本机无处落地（见 FALLBACK_ROOT_UUID
      // 注释：不能退到账号子树）。**报给调用方，别静默吞掉** —— 2026-10-02 真机
      // 的症状正是「日志报同步成功、书签却不出现」。
      onUnplaceableRoot?.(uuid, countBookmarksUnder(uuid));
      return;
    }

    const siblings = siblingsOf(parentChromeId);
    const title = ((meta.title as string) ?? '') || fallbackRootTitle;
    const created = await chrome.create({
      parentId: parentChromeId,
      title,
      index: siblings.length, // 放末尾：不打乱回退根下已有兄弟的顺序
    });
    siblings.push(created);
    chromeNodes.set(created.id, {
      chromeId: created.id,
      parentId: parentChromeId,
      title: created.title,
      url: created.url,
      depth: (chromeNodes.get(parentChromeId)?.depth ?? 0) + 1,
    });
    chromeIds.add(created.id);
    bridge.map(created.id, uuid);
    // 落地根的回退文件夹必须被记录：登录后真账号根出现时按记录退休它，
    // 否则同一 CRDT 子树在本机留下两份 chrome 表示（回退 + 真根）→ 重复捕获。
    if (bridge.isLandingRoot(uuid)) bridge.markFallback(uuid, created.id);
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

      // 根节点下**不是**固定根的，只剩浏览器内部永久文件夹（受管书签、
      // Firefox tags________）。根下**不能** create —— Chrome 只对
      // `is_root()` 报 "Can't modify the root bookmark folders."，一条这样的
      // op 就能让每台新设备的同步直接失败（2026-10-01 实测：新 profile 选默认
      // 空间报错，error_reports 里 app_version=2.7.0 / platform=Chrome 154）。
      // 但**也不能整棵跳过** —— 那会把挂在其下的整棵子树永久藏起来（同一事故的
      // 第二阶段：报错消失后，新设备「同步成功但书签不出现」）。走回退落地：
      // 本机有映射就沿用，没有就在回退固定根下建一个同名文件夹。
      if (parentUuid === ROOT_UUID && !bridge.isLandingRoot(childUuid)) {
        await ensureRootFallback(childUuid, meta);
        queue.push(childUuid);
        continue;
      }

      queue.push(childUuid);

      if (bridge.isLandingRoot(childUuid)) {
        // 固定根本身不是用户节点，永不 create/move/update。原生根恒已落地；
        // Chromium 缺失的「书签菜单」容器由 sync.js 按需创建。
        //
        // ★ 本机**没有**这个根时走回退落地（典型：未登录 Chrome → 账号根不在
        //   getTree() 里，rootResolver 解析不出来）。不处理的话挂在其下的整棵
        //   账号子树会永久投影不出来 —— 和 2026-10-01 那次「同步成功但书签不
        //   出现」是同一类问题。
        //   仅在该根**确有可见子节点**时才建回退文件夹，否则未登录的每台设备
        //   都会在「其他书签」下凭空多出 3 个空账号文件夹。
        //   MENU_UUID 除外：它由 sync.js 管理（容器在书签栏下），不能塞进
        //   「其他书签」。
        // 本机没有这个根（真根缺席 / 映射指向已不存在的节点）且有可见子节点时，
        // 才建回退文件夹。`!landingCid` 不够：登出后旧映射可能指向一个已被 Chrome
        // 删掉的 chromeId，此时也应当重新落地（ensureRootFallback 会先清掉死映射）。
        const landingCid = bridge.toChromeId(childUuid);
        if (
          childUuid !== MENU_UUID &&
          (childrenByParent.get(childUuid)?.length ?? 0) > 0 &&
          (!landingCid || !chromeIds.has(landingCid))
        ) {
          await ensureRootFallback(childUuid, meta);
        }
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
 * Firefox 内置默认书签文件夹的内容指纹。
 *
 * Firefox 首次运行会在**书签菜单**（`menu________` → MENU_UUID）下建一个标题
 * **恰为** "Mozilla Firefox" 的文件夹，内含 4 条固定 Mozilla 链接。
 * ⚠ 2026-10-04 真机实测（Firefox 157，`places.sqlite`：folder `id=7 parent=2`，
 * `id=2` = `menu` 根）确认它挂在**书签菜单**下 —— 此前按「其他书签」过滤导致
 * 真机永不命中、默认书签照旧泄漏（E2E 报 `pushed:5`）。历史/个别版本也可能放在
 * 「其他书签」，两个固定根都认。
 * 该文件夹的 GUID 每个 profile 随机（无法按 GUID 过滤），标题在所有语言都是
 * 字面量 "Mozilla Firefox"，URL 取自 Firefox 的 default-bookmarks.html。
 *
 * 它不属于用户数据，不应进入共享空间（否则每台 Firefox 设备首次同步都会把
 * 这份模板灌进云端）。用「标题 + 位置 + 全部叶子 URL ⊆ 默认集」三重指纹识别：
 * 用户一旦往里加了自己的书签，URL 不再全属默认集 → 不再跳过（用户改过就别动）。
 */
const FF_DEFAULT_BOOKMARK_URLS: ReadonlySet<string> = new Set([
  'https://support.mozilla.org/products/firefox',
  'https://support.mozilla.org/kb/customize-firefox-controls-buttons-and-toolbars',
  'https://www.mozilla.org/about/',
  'https://www.mozilla.org/contribute/',
]);
const normalizeBookmarkUrl = (url: string): string =>
  url.toLowerCase().split('?')[0].replace(/\/+$/, '');
const FF_DEFAULT_BOOKMARK_URLS_NORM: ReadonlySet<string> = new Set(
  [...FF_DEFAULT_BOOKMARK_URLS].map(normalizeBookmarkUrl),
);
function isFirefoxDefaultBookmarksFolder(node: ChromeTreeNode, parentUuid: string): boolean {
  // 真机在「书签菜单」下；「其他书签」是历史/个别版本的位置，一并认。
  if (parentUuid !== MENU_UUID && parentUuid !== OTHER_BOOKMARKS_UUID) return false;
  if (node.url) return false;
  if (node.title !== 'Mozilla Firefox') return false;
  const urls: string[] = [];
  const collect = (n: ChromeTreeNode): void => {
    if (n.url) urls.push(n.url);
    for (const c of n.children ?? []) collect(c);
  };
  collect(node);
  return (
    urls.length > 0 && urls.every((u) => FF_DEFAULT_BOOKMARK_URLS_NORM.has(normalizeBookmarkUrl(u)))
  );
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
 * 已映射节点跳过（继续走子树）；未映射节点**先按内容认领**一个已有 CRDT 节点
 * （见 contentFingerprint.ts），认领不到才生成随机 uuid 并 createNodeWithId。
 * 「内容认领」是「内容认领」轮的核心：同一逻辑书签在不同设备 / 不同登录态下
 * 由各自捕获时，会因内容指纹相同而**共用同一个 uuid**，不再各自新建一份
 * （跨设备翻倍 / 登录态切换重复的根因）。候选按 uuid 升序消费，多台设备对同一
 * 组候选给出相同配对（确定性收敛）；合法重复（同父同内容的 N 条）各占一个候选，
 * 候选耗尽才新建 —— 不误并。
 *
 * **回退文件夹：不建自身节点，但递归其子树到落地根 uuid**：它只是某个落地根在
 * 「本机没有真根」时的临时落地（内容真身在 CRDT，父节点 = 该落地根 uuid）。
 * 真根出现后由 retireFallbackFolders() 退休。已投影的子节点命中 existing 分支
 * （无 op），不会重复捕获；而用户**新加**进回退文件夹的未映射节点才能被捕获
 * —— 旧实现整棵跳过 → Firefox/Edge 上永久回退文件夹里的书签静默不同步，退休
 * 时还会永久丢失。
 *
 * 遍历相对 chrome 事件处理器是原子的：getTree 之后整个 walk 无外部 await，
 * 事件回调（宏任务）不会插进遍历中间；onCreated 侧的「已映射即让路」守卫
 * 保证先后到达都不会产生重复节点。
 *
 * **浏览器根下的「未识别」子节点整棵跳过**（见 walk 内守卫）：Chrome 受管书签
 * 永久文件夹、Firefox `tags________` 都不是本扩展的固定根拓扑，捕获它们会生成
 * parent=ROOT_UUID 的 op，而根下不允许 create。识别判据是「是否已在桥里预置
 * 映射」——本地根与账号（syncing）根都预置，因此都会被正常捕获。
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

  // chromeId -> 节点 / 父节点：用于「回退文件夹祖先」判定。
  const nodeById = new Map<string, ChromeTreeNode>();
  const parentOf = new Map<string, string>();
  const seedTree = (n: ChromeTreeNode, parentId?: string): void => {
    nodeById.set(n.id, n);
    if (parentId !== undefined) parentOf.set(n.id, parentId);
    for (const c of n.children ?? []) seedTree(c, n.id);
  };
  for (const r of tree) seedTree(r);

  // 内容索引：同一父节点下、同类型同标题同 URL 的可见 CRDT 节点 uuid 列表。
  const index = new Map<string, string[]>();
  for (const edge of coordinator.replica.getVisibleTree()) {
    if (bridge.isLandingRoot(edge.child)) continue; // 固定根不是用户节点
    const key = contentKey(edge.parent, edge.meta);
    const arr = index.get(key);
    if (arr) arr.push(edge.child);
    else index.set(key, [edge.child]);
  }
  // 候选按 uuid 升序：多台设备对同一组候选给出相同配对（确定性收敛）。
  for (const arr of index.values()) arr.sort();

  const underFallback = (chromeId: string): boolean => {
    const seen = new Set<string>();
    let cur: string | undefined = chromeId;
    while (cur && !seen.has(cur)) {
      if (bridge.isFallbackChromeId(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return false;
  };
  // 可认领 = 本机未映射 / 映射指向本机已不存在的节点 / 仅由回退文件夹表示。
  // 本机已映射到真实节点的 uuid 不认领 —— 那是用户在本机真实存在的书签，
  // 静默合并会丢东西。
  const claimable = (uuid: string): boolean => {
    const cid = bridge.toChromeId(uuid);
    if (cid === null) return true;
    if (!nodeById.has(cid)) return true;
    return underFallback(cid);
  };

  let captured = 0;
  const walk = async (node: ChromeTreeNode, parentUuid: string): Promise<void> => {
    // Firefox 内置默认书签文件夹（见 isFirefoxDefaultBookmarksFolder）：整棵跳过。
    if (isFirefoxDefaultBookmarksFolder(node, parentUuid)) return;

    // 回退文件夹：不建自身节点，但把子树递归到它代表的落地根 uuid 下
    // （见函数注释）。已投影子节点命中 existing（无 op）；用户新加的未映射
    // 节点按内容认领/新建，正确落在落地根下。
    if (bridge.isFallbackChromeId(node.id)) {
      const fbRoot = bridge.fallbackRootOf(node.id);
      if (fbRoot === null) return; // 记录不一致：保持整棵跳过（安全兜底）
      for (const child of node.children ?? []) await walk(child, fbRoot);
      return;
    }

    // 浏览器根（"0" / `root________`）下只有**已解析出的固定根**是「我们的」节点
    // ——它们在 IdBridge 构造期就已预置映射，走下面的 existing 分支续走子树。
    // 这既包含本地根，也包含账号（syncing）根：后者 chromeId 动态，由
    // src/sync/rootResolver.ts 按 folderType + syncing 解析后 seed 进桥。
    // 其余根子节点是浏览器内部永久文件夹（受管书签 / Firefox `tags________`），
    // **不映射、不捕获、不下钻**。
    // 一旦被捕获就会生成 parent=ROOT_UUID 的 CRDT 节点 —— op 日志 append-only，
    // 那条 op 永久留在云端，之后**每台新设备**投影时都会在根下 create，Chrome
    // 直接报 "Can't modify the root bookmark folders."（2026-10-01 线上事故）。
    // ⚠ 必须保留 `parentUuid === ROOT_UUID &&` 前缀：写成裸的
    //   `bridge.toUuid(node.id) === null` 会跳过所有未映射节点，捕获全废。
    if (parentUuid === ROOT_UUID && bridge.toUuid(node.id) === null) return;
    const existing = bridge.toUuid(node.id);
    if (existing) {
      // 固定根（Chrome "0".."3" / Firefox 根）与已映射用户节点直接续走
      // 子树：不产生新 op
      for (const child of node.children ?? []) await walk(child, existing);
      return;
    }

    // 未映射：先按内容认领一个已有 CRDT 节点，认领不到才新建。
    const candidates = index.get(contentKey(parentUuid, node));
    let claimed: string | null = null;
    while (candidates && candidates.length > 0) {
      const cand = candidates.shift()!;
      if (claimable(cand)) {
        claimed = cand;
        break;
      }
    }
    if (claimed) {
      // 抢绑：map() 会解掉该 uuid 在回退侧的旧向映射（不产生 op）。
      bridge.map(node.id, claimed);
      for (const child of node.children ?? []) await walk(child, claimed);
      return;
    }

    // Fix C：replica 缺行时内容索引不全，未认领可能是「云端已有、本机 replica
    // 没拉到」的存量节点。此时盲建 = 永久 CRDT 重复（2026-10-04 事故）。安全做法：
    // 推迟——本节点及其未映射子树整体留给 replica 补齐后的下一轮同步再认领/新建，
    // 绝不在此刻造新 uuid。（replica 完整时该分支不触发，正常新建不受影响。）
    if (coordinator.isReplicaIncomplete) {
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

/**
 * 退休「回退文件夹」：登录态切换（或账号根重新出现）后的收尾。
 *
 * 未登录时账号子树落在 `ensureRootFallback` 建的回退文件夹里；登录后真账号根
 * 出现，同一 CRDT 子树在本机就有了两份 chrome 表示。本函数把回退整棵退休：
 *   1. 先**丢弃回退子树里所有 chromeId→uuid 映射**（不产生任何 op）；
 *   2. 再 `removeTree` 回退文件夹 —— 此时其下已无映射，`onRemoved` 找不到
 *      uuid，**不会误发墓碑**；
 *   3. 清除回退记录。
 * 退休后：被认领的节点已绑到真根的子节点上；未被认领的（真根里还没有的）由
 * 紧随其后的 reverseApply 在真根下重新落地 —— 内容一条不丢。
 *
 * 仅在「该落地根已解析到真根」（backward[U] ≠ 回退文件夹）时退休；仍由回退
 * 代表的根保持原样。返回退休的回退文件夹数。
 */
export async function retireFallbackFolders(
  chrome: ChromeBookmarksAPI,
  bridge: IdBridge,
): Promise<number> {
  const entries = bridge.fallbackEntries();
  if (entries.length === 0) return 0;
  const tree = (await chrome.getTree()) ?? [];
  const childrenOf = new Map<string, string[]>();
  const exists = new Set<string>();
  const seed = (n: ChromeTreeNode): void => {
    exists.add(n.id);
    childrenOf.set(
      n.id,
      (n.children ?? []).map((c) => c.id),
    );
    for (const c of n.children ?? []) seed(c);
  };
  for (const r of tree) seed(r);

  let retired = 0;
  for (const [uuid, folderId] of entries) {
    // 仍由回退文件夹代表这个根（真根不在本机）→ 保留。
    if (bridge.toChromeId(uuid) === folderId) continue;
    if (!exists.has(folderId)) {
      bridge.clearFallback(uuid); // 文件夹已不在：清掉陈旧记录即可
      continue;
    }
    // 1) 丢弃回退子树里的全部映射（先丢映射，避免 removeTree 触发墓碑）。
    const stack = [folderId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cid = stack.pop()!;
      if (seen.has(cid)) continue;
      seen.add(cid);
      if (bridge.toUuid(cid) !== null) bridge.removeByChromeId(cid);
      for (const ch of childrenOf.get(cid) ?? []) stack.push(ch);
    }
    // 2) 删除回退文件夹（其下已无映射 → 不产生墓碑）。
    try {
      await chrome.removeTree(folderId);
    } catch {
      // 已不存在 / 浏览器拒绝：忽略，记录照样清掉。
    }
    // 3) 清记录。
    bridge.clearFallback(uuid);
    retired++;
  }
  return retired;
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
 *
 * ★ 墓碑护栏：删节点时**保留映射**（判据就是映射），`removeTree` 触发的
 * `onRemoved` 会查到 uuid。若不豁免，它在抑制解除后被 `pendingRemoved` 补调
 * 成墓碑 push 上云 → 跨设备互删（2026-10-04 实测 3562 条 trash op 上云）。
 * 用 `pluginRemovedIds` 登记来源，`handleRemoved` 见之直接放行。
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
    // 根的直接子节点恒为永久节点（书签栏/其他书签/移动设备，以及 Chrome 的账号
    // 书签 / 受管书签永久文件夹——后者 id 动态分配，不在 PROTECTED_CHROME_IDS
    // 里）。Chrome 的 `RemoveNode()` 对永久节点返回 kModifySpecialError，与
    // create 撞的是同一句 "Can't modify the root bookmark folders."，所以根子
    // 节点一律不删（与 capture/ensure 的根守卫同一条不变式）。
    if (info.parentId && BROWSER_ROOT_IDS.has(info.parentId)) continue;
    const uuid = bridge.toUuid(info.chromeId);
    if (uuid === null) continue; // unmapped: leave alone
    // 映射到固定根的 chromeId 一律不删（本地根 / 账号根 / 菜单容器）。账号根的
    // chromeId 是动态的，PROTECTED_CHROME_IDS 认不出来，靠这条兜住。
    if (bridge.isLandingRoot(uuid)) continue;
    if (!reachable.has(uuid)) toDelete.push(info);
  }
  toDelete.sort((a, b) => b.depth - a.depth); // deepest first
  for (const info of toDelete) {
    if (!chromeNodes.has(info.chromeId)) continue; // already removed via ancestor
    // ★ 登记「本次是插件删的」。removeTree 会触发 onRemoved，而本函数刻意
    // **保留映射**（删除判据就是映射），于是 handleRemoved 能查到 uuid →
    // 若不登记，它会在抑制解除后被 `pendingRemoved` 补调当成「用户删书签」
    // → `deleteNode` 墓碑 → **push 上云**，把本机丢数据升级成跨设备云端污染
    // （实测某空间 3562 条 trash op 上云、可见树归零，2026-10-04）。
    // 对照 `retireFallbackFolders`：它先丢映射再删，所以不发墓碑 —— 那是
    // 「先摘映射」路线；本函数必须留映射，只能走「标记豁免」路线。
    pluginRemovedIds.add(info.chromeId);
    await chrome.removeTree(info.chromeId);
    chromeNodes.delete(info.chromeId);
  }
}
