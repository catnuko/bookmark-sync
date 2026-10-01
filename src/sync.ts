// 书签同步引擎 v2 —— Move-CRDT 操作日志模型（Phase C-2）
// ------------------------------------------------------------------
// 取代旧的「真树快照 + 三态基线合并」。本文件是面向 App.vue / background 的
// 薄封装：
//   - 数据面：src/sync/（SyncCoordinator + 操作日志 + 操作级 E2EE）
//   - 控制面：直接调用 0017 迁移里的 RPC（bsync_space_* / bsync_device_* /
//     bsync_get_profile / bsync_op_push / bsync_op_pull）
//
// CRDT 语义下，「合并」是自动的（并集收敛，不会丢书签、不会成环），所以旧的
// 首同步四象限决策已废弃。唯一保留的一次决策是**首绑**（这台电脑加入哪个空间，
// 见 sync/binding.ts）——那是「本机书签归属」唯一一次可选的时机。
// ------------------------------------------------------------------

import { api } from './lib/ext.js';
import { describeError } from './lib/errors.js';
import { supabase } from './lib/supabase.js';
import { reportError } from './lib/telemetry.js';
import { t } from './lib/i18n.js';
import {
  SupabaseOpLogTransport,
  SyncCoordinator,
  MemoryOpLogTransport,
  captureLocalEvents,
  captureLocalTree as captureUnmappedTree,
  IdBridge,
  IS_FIREFOX,
  nativeRootPairs,
  reverseApply,
  firstBindAction,
  isPaidPlan,
  normalizeBindMode,
  parseBinding,
} from './sync/index.js';
import { KeyManager } from './sync/index.js';
import type { BindMode, ChromeBookmarksAPI, ChromeTreeNode, PullOutcome } from './sync/index.js';
import type { Session } from '@supabase/supabase-js';
import { MENU_UUID, MOBILE_UUID, openBookmarkDb, OutboxStore } from './crdt/index.js';

const DEVICE_ID_KEY = 'crdt.deviceId';
/**
 * 按空间分区的持久化键（每个空间各自一套水位/计数器/映射）。
 * 项目未上架、无历史部署，故不做「历史全局键继承」——旧的 `crdt.afterId` /
 * `crdt.counter` / `crdt.idmap` 单键只在 resetSyncState 里当垃圾清理。
 */
const AFTER_ID_PREFIX = 'crdt.afterId.';
const COUNTER_PREFIX = 'crdt.counter.';
const IDMAP_PREFIX = 'crdt.idmap.';
/** 历史（全局）键：仅 resetSyncState 清理用。 */
const LEGACY_KEYS = ['crdt.afterId', 'crdt.counter', 'crdt.idmap'];
/**
 * 本机**绑定**的空间（一设备一空间）。
 *
 * 语义：本机书签树 ≡ 绑定空间，落地区恒为浏览器原生根。换绑是一次显式危险
 * 操作（清空本机书签 + 重建目标空间），不做热切换——同一浏览器资料内同时装
 * 两套书签既没有 Chrome API 支持（地址栏星标只认原生书签栏），也会让「我收藏
 * 的书签进了哪个空间」变成谜题。
 *
 * 存盘值 = `{ u: 账号 id, s: 空间 id }`：绑定是「账号 × 设备」的事实，换个账号
 * 登录不能继承上一个账号的绑定（见 binding.ts parseBinding 的注释）。
 */
export const BOUND_SPACE_KEY = 'boundSpaceId';
/** 旧「活动空间」键（B2 热切换遗留）：一次性迁移清理用。 */
const LEGACY_ACTIVE_SPACE_KEY = 'activeSpaceId';
/** 旧「容器注册表」键（B2 多容器并存遗留）：一次性迁移清理用。 */
const LEGACY_SPACE_ROOTS_KEY = 'crdt.spaceRoots';
/** B2 → 设备绑定空间的一次性迁移标记。 */
const SPACE_MIGRATED_KEY = 'crdt.spaceMigrated';
/** op-log GC 阈值（storage 键可覆盖；E2E 注入小阈值验证 GC 链路）。 */
const GC_THRESHOLD_KEY = 'crdt.gcThreshold'; // 历史遗留 key，仅 resetSyncState 清理用

/** Chromium 端 MENU_UUID（书签菜单）动态容器的持久化 chromeId。 */
const MENU_FOLDER_KEY = 'crdt.menuFolderId';
const MENU_FOLDER_TITLE = '书签菜单';

/** 按空间分区的键名（多空间下每个空间各自一套水位/计数器/映射）。 */
const afterIdKey = (spaceId: string): string => AFTER_ID_PREFIX + spaceId;
const counterKey = (spaceId: string): string => COUNTER_PREFIX + spaceId;
const idmapKey = (spaceId: string): string => IDMAP_PREFIX + spaceId;

/** 取 chrome.bookmarks（MV3 声明了 bookmarks 权限，扩展上下文内恒存在）。 */
function nativeBookmarks(): ChromeBookmarksAPI | undefined {
  return (globalThis as typeof globalThis & { chrome?: { bookmarks?: ChromeBookmarksAPI } }).chrome
    ?.bookmarks;
}

/** 删除所有以 prefix 开头的按空间键（换密钥 / 一键重置用）。 */
async function removeAllScoped(prefix: string): Promise<void> {
  try {
    const all = await api.storage.local.get();
    const keys = Object.keys(all ?? {}).filter((k) => k.startsWith(prefix));
    if (keys.length) await api.storage.local.remove(keys);
  } catch {
    /* storage 不可用时忽略 */
  }
}

const keyManager = new KeyManager({
  async get(key: string) {
    return (await api.storage.local.get(key))[key] as string | undefined;
  },
  async set(key: string, value: string) {
    await api.storage.local.set({ [key]: value });
  },
  async remove(key: string) {
    await api.storage.local.remove(key);
  },
});

// ---- 业务数据类型（来自 supabase RPC / 表行，供 store / background 使用）----

/** 空间行（bsync_spaces）。 */
export interface SpaceInfo {
  id: string;
  name: string;
  is_default?: boolean;
  bookmark_count?: number;
  device_count?: number;
  created_at?: string;
}

/** 设备行（bsync_devices，listDevices 归一化后）。 */
export interface DeviceInfo {
  device_id: string;
  /** v2 表原始字段：id / last_seen_at（listDevices 内归一化）。 */
  id?: string;
  last_seen_at?: string | null;
  name?: string;
  device_name?: string;
  space_id?: string;
  space_name?: string;
  // 真实值 = 数据库 ISO 字符串；preview 演示数据用毫秒时间戳（组件 fmtRelative 两者都能解析）。
  last_sync_at?: string | number | null;
  last_space_id?: string;
}

/** 付费档案（bsync_get_profile）。 */
export interface ProfileInfo {
  plan?: string;
  used_count?: number;
  used_bytes?: number;
  quota_bytes?: number;
  purchased_at?: string;
}

/** 空间/设备控制面的统一返回（reason 供 store.reasonText 本地化）。 */
export type SpaceActionResult =
  | { ok: true; space?: SpaceInfo }
  | { ok: false; reason: string; error: string };

/** runSync 的返回：成功带方向摘要；失败带 reason 码（+ 可选 spaces 供首绑门禁）。 */
export type SyncRunResult =
  | {
      ok: true;
      pushed: number;
      pulled: number;
      seeded?: boolean;
      restored?: boolean;
      decryptFailed?: number;
      /** 同步途中空间被换绑/密钥被重置：本轮投影放弃，但数据不丢。 */
      superseded?: boolean;
    }
  | {
      ok: false;
      reason: string;
      error?: string;
      spaces?: Array<{ id: string; name: string; is_default: boolean }>;
    };

// ---- 设备 ID（UUID，同时作为 CRDT replicaId）----
export async function getDeviceId(): Promise<string> {
  const res = await api.storage.local.get(DEVICE_ID_KEY);
  if (res[DEVICE_ID_KEY]) return res[DEVICE_ID_KEY] as string;
  const id = globalThis.crypto.randomUUID();
  await api.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

// ---- Profile / 空间 / 设备 控制面 ----

/**
 * 把 supabase 返回的 `error` 变成**不丢信息**的 Error。
 *
 * 它不保证是 Error 实例（PostgrestError 实测是普通对象 `{message, details, hint, code}`）。
 * 裸 `throw error` 出去而调用方又没接住时，Chrome 扩展错误列表只会显示 `[object Object]`
 * 加几个压缩后的堆栈帧，等于没线索 —— 2026-09-29 排查 popup 启动报错时就卡在这里。
 * 走 `describeError` 至少留下服务端原话。写法与 sync/oplogClient.ts 的同名函数一致。
 */
function rpcError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(describeError(error));
}

export async function getProfile(): Promise<ProfileInfo> {
  const { data, error } = await supabase.rpc('bsync_get_profile');
  if (error) throw rpcError(error);
  return data as ProfileInfo;
}

/**
 * 当前登录账号 id（无会话 = 空串）。
 *
 * 用 getSession（本地已缓存的会话）而不是 getUser：绑定解析在每次登录取数、
 * 每次同步前都要跑，不该为此多发一次网络往返。
 */
async function currentUserId(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? '';
  } catch {
    return '';
  }
}

/**
 * 当前账号还能不能新建空间（首绑门禁判据之一，见 sync/binding.ts）。
 *
 * 只按计划档位判（`isPaidPlan`），**不**在客户端复刻 plan→空间上限的映射——那份
 * 映射唯一的家在服务端 `bsync_space_create`，复制一份迟早漂移。已达到上限的付费
 * 用户由服务端的 `plan_locked` + 升级引导兜住（store 的 doBindSpace 已处理）。
 *
 * 取不到 profile（离线 / RPC 失败）时按 false 处理 = 保持静默绑定：宁可少问一次，
 * 也不要把免费用户误推进整页门禁；付费用户这一步的选择权在空间列表的换绑里还在。
 */
async function planCanCreateSpace(): Promise<boolean> {
  try {
    const p = await getProfile();
    return isPaidPlan(p?.plan);
  } catch {
    return false;
  }
}

/**
 * 本机绑定的空间（一设备一空间，`boundSpaceId` = `{ u: 账号, s: 空间 }`）。
 *
 * **纯读，唯一例外**：把旧格式（裸字符串）记录就地升级成带账号的格式——升级不
 * 改变绑定事实，「从未绑定」绝不会被写成「已绑定」。除此之外不落盘。
 *
 * 为什么必须纯读：早期版本在这个函数里悄悄把 `boundSpaceId` 写成默认空间，
 * 「本机是否绑定过」这个事实当场被抹掉——首绑引导再也判不出来，用户也就永远
 * 没有机会选择这台电脑加入哪个空间。
 *
 * 为什么要校验归属账号：绑定是「账号 × 设备」的事实。同账号重登必须还是原来
 * 的绑定（登出不能把它抹掉，否则每次重登都被当成新设备重新问一遍）；换账号则
 * 必须按从未绑定处理（继承别人的空间 id 会误报「空间已删」，甚至把本机书签写进
 * 不相干的空间）。
 *
 * 三种情形：
 *   - `bound != null`：已绑定，空间还在；
 *   - `bound == null, stale == false`：**本机从未绑定过**（首次引导的判定条件）；
 *   - `bound == null, stale == true`：绑定过但空间已被删。不自动回落——那会在
 *     用户不知情时换掉同步目标。
 */
export async function getBoundSpace(): Promise<{
  spaces: SpaceInfo[];
  bound: SpaceInfo | null;
  stale: boolean;
}> {
  const { data, error } = await supabase
    .from('bsync_spaces')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw rpcError(error);
  const spaces = (data ?? []) as SpaceInfo[];
  const owner = await currentUserId();
  const { [BOUND_SPACE_KEY]: stored } = await api.storage.local.get(BOUND_SPACE_KEY);
  const rec = parseBinding(stored, owner);
  const bound = rec.mine ? (spaces.find((s) => s.id === rec.spaceId) ?? null) : null;
  if (rec.legacy && rec.mine) {
    await api.storage.local.set({ [BOUND_SPACE_KEY]: { u: owner, s: rec.spaceId } });
  }
  return { spaces, bound, stale: rec.mine && !bound };
}

/**
 * 本机是否已有**属于当前账号**的绑定记录（纯本地读，不发网络请求）。
 *
 * 用途：popup 首屏决定「要不要等云端」。首绑门禁只可能在「本机从未绑定」时挡出
 * （`bindGateNeeded` 里 `boundStale` 与 `bound != null` 两条都直接让开），而这个
 * 事实完全在本地——已绑定的机器可以直接渲染主界面，不必等 `bsync_spaces` 回来；
 * 只有从未绑定的机器才需要等云端取回空间列表判门禁，否则会先渲染主界面、再被
 * 整页门禁盖上（违反「登录 → 门禁 → 主界面」的顺序）。
 *
 * 读不到（storage 异常 / 无会话）一律按未绑定处理：走「等云端」的保守分支，
 * 代价只是多等一次取数，而不是漏挡门禁。
 */
export async function hasLocalBinding(): Promise<boolean> {
  try {
    const owner = await currentUserId();
    const { [BOUND_SPACE_KEY]: stored } = await api.storage.local.get(BOUND_SPACE_KEY);
    return parseBinding(stored, owner).mine;
  } catch {
    return false;
  }
}

/**
 * B2「多容器并存」→「设备绑定空间」的一次性迁移。
 *
 * B2 时代本机可能残留：① 容器注册表 `crdt.spaceRoots`；② 书签栏下的容器
 * 文件夹「书签空间 · X」；③ 旧活动空间键 `activeSpaceId`。新方案下本机书签树
 * 必须 ≡ 绑定空间（= 默认空间，本机书签原本就是它的投影），残留容器属于**别的
 * 空间**，必须一并清掉——否则下一轮 capture 会把它们当「未映射书签」捕获进
 * 绑定空间（凭空多出文件夹）。
 *
 * 清理在「事件桥拿不到映射」的状态下进行（`dropBridgeCache()` 先摘掉活动桥，
 * 事件处理器见 bridge 为 null 即跳过），所以删容器**不会**给任何空间造墓碑。
 * 水位 / 计数器 / 映射 / 口令一律不动。只执行一次。
 */
async function migrateFromMultiSpaceOnce(): Promise<void> {
  try {
    const res = await api.storage.local.get([SPACE_MIGRATED_KEY, LEGACY_SPACE_ROOTS_KEY]);
    if (res[SPACE_MIGRATED_KEY]) return;
    const registry = res[LEGACY_SPACE_ROOTS_KEY] as Record<string, unknown> | undefined;
    const chrome = nativeBookmarks();
    dropBridgeCache();
    if (registry && typeof registry === 'object' && chrome) {
      const nativeIds = new Set(nativeRootPairs(IS_FIREFOX).map(([cid]) => cid));
      for (const row of Object.values(registry)) {
        const cid = (row && typeof row === 'object' && (row as { rootId?: unknown }).rootId) || '';
        if (!cid || typeof cid !== 'string' || nativeIds.has(cid)) continue;
        try {
          await chrome.removeTree(cid); // 容器（其内容在云端有副本，不丢数据）
        } catch {
          /* 已被用户删掉：忽略 */
        }
      }
    }
    await api.storage.local.remove([LEGACY_SPACE_ROOTS_KEY, LEGACY_ACTIVE_SPACE_KEY]);
    await api.storage.local.set({ [SPACE_MIGRATED_KEY]: 1 });
  } catch {
    /* 迁移失败不阻塞同步：下轮再试 */
  }
}

// 把 RPC 错误归一化为 { ok:false, reason, error }。
// 后端 RAISE EXCEPTION '<code>' 的 message 即 reason（plan_locked /
// cannot_delete_default / invalid_name / not_found）；唯一索引冲突（23505）
// 归一为 duplicate，与 store.js 的 reason 分支对齐。
function spaceRpcError(err: unknown): { ok: false; reason: string; error: string } {
  if (!err) return { ok: false, reason: 'unknown', error: 'unknown error' };
  const e = err as { message?: unknown; code?: unknown };
  const msg = typeof e.message === 'string' ? e.message : '';
  if (e.code === '23505') return { ok: false, reason: 'duplicate', error: msg };
  // RAISE EXCEPTION 的自定义 code 直接作为 reason
  // （0032：quota_exceeded / rate_limited；0033：device_limit_reached）
  for (const code of [
    'plan_locked',
    'cannot_delete_default',
    'invalid_name',
    'not_found',
    'not_authenticated',
    'quota_exceeded',
    'rate_limited',
    'device_limit_reached',
  ]) {
    if (msg.includes(code)) return { ok: false, reason: code, error: msg };
  }
  return { ok: false, reason: msg, error: msg };
}

export async function createSpace(name: string): Promise<SpaceActionResult> {
  const { data, error } = await supabase.rpc('bsync_space_create', { p_name: name });
  if (error) return spaceRpcError(error);
  return { ok: true, space: data as SpaceInfo };
}

export async function renameSpace(id: string, name: string): Promise<SpaceActionResult> {
  const { error } = await supabase.rpc('bsync_space_rename', { p_space: id, p_name: name });
  if (error) return spaceRpcError(error);
  return { ok: true };
}

export async function deleteSpace(id: string): Promise<SpaceActionResult> {
  const { error } = await supabase.rpc('bsync_space_delete', { p_space: id });
  if (error) return spaceRpcError(error);
  return { ok: true };
}

/**
 * 写下绑定，并丢弃与新目标无关的内存状态（coordinator / 映射桥 / 世代）。
 *
 * 连账号 id 一起写：绑定是「账号 × 设备」的事实，换账号登录时才能判出「这条
 * 记录不属于当前账号」而按从未绑定处理（见 getBoundSpace）。
 */
async function commitBinding(id: string): Promise<void> {
  const owner = await currentUserId();
  await api.storage.local.set({ [BOUND_SPACE_KEY]: { u: owner, s: id } });
  // 下次同步按新空间重建：水位/计数器/映射都按空间分区，各自续拉，不互相污染。
  _coordinator = null;
  _bootPromise = null;
  _coordinatorGen++;
  dropBridgeCache();
}

/**
 * 首次绑定本机空间（新设备第一次同步前的显式选择）。
 *
 * 与 `rebindSpace` 的两点区别，都来自「本机还没有被任何空间捕获过」：
 *   1. **不需要 drainPush**——没有旧空间的本地变更要保命；
 *   2. `mode: "merge"`（默认）**不清空本机书签**——本机书签直接并入目标空间
 *      （「把这台电脑的书签加入工作空间」）；`mode: "overwrite"` 则先清空本机，
 *      再由目标空间的 CRDT 重建（「我只要该空间的书签」）。
 *
 * 由 SW（background）执行：只有 SW 持有与事件桥同 realm 的 coordinator 单例。
 */
export async function bindSpace(
  id: string,
  { mode }: { mode?: BindMode } = {},
): Promise<{ ok: boolean; noop?: boolean }> {
  const cur = getCoordinatorCached();
  if (cur && cur.spaceId === id) return { ok: true, noop: true };
  // mode 来自 UI 消息，不可信：非法值一律退回 merge（不破坏本机数据的那个）。
  const m = normalizeBindMode(mode);
  await flushPersist(); // 未推送 op 先落 outbox（IndexedDB）
  if (m === 'overwrite') await clearNativeBookmarks();
  await commitBinding(id);
  console.log(`[bsync] 已绑定本机空间 → ${id}（${m === 'overwrite' ? '覆盖本机' : '并入本机'}）`);
  return { ok: true };
}

/**
 * 换绑本机空间（危险操作，需用户在 UI 显式确认）。
 *
 * 语义：本机书签树 ≡ 绑定空间，所以换绑 = **清空本机书签 + 重建目标空间**。
 * 这是一次性的低频操作（不是热切换），也是本方案唯一的破坏性动作，因此：
 *   1. 旧空间的本地变更必须**推送成功**才允许换绑（推不动就不换，把失败原因
 *      交回 UI）——否则本地改动会停在「已入队未推送」的中间态；
 *   2. 清空在「事件桥拿不到映射」的状态下进行，**不产生任何墓碑**——否则本机
 *      删除会被当成「用户删除了书签」写进旧空间的 CRDT，真删云端数据；
 *   3. 清空后丢弃旧空间的映射（chromeId 已全部失效），换绑完成后下一轮同步用
 *      目标空间的 CRDT 把书签重新投影出来。
 *
 * 由 SW（background）执行：只有 SW 持有与事件桥同 realm 的 coordinator 单例。
 */
export async function rebindSpace(
  id: string,
): Promise<{ ok: boolean; reason?: string; noop?: boolean }> {
  const cur = getCoordinatorCached();
  if (cur && cur.spaceId === id) return { ok: true, noop: true };
  if (cur) {
    await flushPersist(); // 未推送 op 先落 outbox（IndexedDB），推送失败也不丢
    if (!(await drainPush(cur))) {
      return { ok: false, reason: 'push_failed' };
    }
  }
  await flushPersist();
  await clearNativeBookmarks();
  await commitBinding(id);
  console.log(`[bsync] 已换绑本机空间 → ${id}`);
  return { ok: true };
}

/**
 * 清空本机书签（保留固定根），用于换绑。
 *
 * 关键：先 `dropBridgeCache()` 摘掉活动映射桥，之后到达的 onRemoved 事件在
 * `getB()` 处拿到 null 直接返回——**既不造墓碑，也不 push**。绝不能用
 * `suppressed` 代替：抑制期间删除事件会进 pending 队列，抑制结束时才补处理，
 * 那时映射桥已经换成了新空间，会把本机的清空误记成新空间的删除。
 *
 * Firefox 的「移动设备书签」（`mobile______`）归 Firefox Sync 管，不碰。
 */
async function clearNativeBookmarks(): Promise<void> {
  const chrome = nativeBookmarks();
  if (!chrome) return;
  dropBridgeCache();
  for (const [rootId, uuid] of nativeRootPairs(IS_FIREFOX).slice(1)) {
    if (IS_FIREFOX && uuid === MOBILE_UUID) continue;
    let kids: ChromeTreeNode[] = [];
    try {
      kids = (await chrome.getChildren(rootId)) ?? [];
    } catch {
      continue;
    }
    for (const k of kids) {
      try {
        await chrome.removeTree(k.id);
      } catch {
        /* 已被删：忽略 */
      }
    }
  }
  // Chromium 的「书签菜单」容器挂在书签栏下，已随上面一并删掉 → 清掉记录。
  try {
    await api.storage.local.remove(MENU_FOLDER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 把某空间的未推送 op 推完（含等待并发中的 flushPush），超时/失败返回 false。
 *
 * `flushPush` 在「已有推送在途」时直接返回 0（防重入），所以必须轮询到
 * pendingPush 真的空——否则会在有在途推送时误判「已推完」而放行切换。
 */
async function drainPush(coordinator: SyncCoordinator, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pendingCount(coordinator) === 0) return true;
    try {
      await coordinator.flushPush();
      await api.storage.local.set({
        [counterKey(coordinator.spaceId)]: coordinator.replica.counter,
      });
      await api.storage.local.set({ [afterIdKey(coordinator.spaceId)]: coordinator.afterId });
    } catch (e) {
      console.warn(`[bsync] 切换空间前推送失败: ${(e as { message?: unknown })?.message ?? e}`);
      return false;
    }
    if (pendingCount(coordinator) === 0) return true;
    if (Date.now() >= deadline) {
      console.warn(`[bsync] 切换空间前推送超时（剩 ${pendingCount(coordinator)} 条未推送）`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function pendingCount(coordinator: SyncCoordinator | null | undefined): number {
  return coordinator?.pendingPushCount ?? 0;
}

/**
 * 某空间的设备列表。
 *
 * `spaceId` 显式传 `null` = 「本机没有绑定空间，直接空集」，**不回落**去查一次
 * `bsync_spaces`。回落分支只服务于「调用方手上没有 bound」的场景；首屏关键路径
 * 上的 refreshSpacesDevices 已经拿到 bound，再查一遍就是白白多一次往返。
 */
export async function listDevices(spaceId?: string | null): Promise<DeviceInfo[]> {
  const sid = spaceId !== undefined ? spaceId : (await getBoundSpace()).bound?.id;
  if (!sid) return [];
  const { data, error } = await supabase
    .from('bsync_devices')
    .select('*')
    .eq('space_id', sid)
    .order('last_seen_at', { ascending: false });
  if (error) throw rpcError(error);
  // 归一化到 App.vue 期望的字段名（v2 表是 id / last_seen_at）。
  return ((data ?? []) as Array<Record<string, unknown>>).map((d) => ({
    ...d,
    device_id: d.id,
    last_sync_at: d.last_seen_at,
  })) as DeviceInfo[];
}

export async function removeDevice(deviceId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('bsync_device_remove', { p_device: deviceId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function renameDevice(deviceId: string, name: string): Promise<SpaceActionResult> {
  const { error } = await supabase.rpc('bsync_device_rename', { p_device: deviceId, p_name: name });
  if (error) return spaceRpcError(error);
  return { ok: true };
}

// 服务端书签计数（v2：从 profile.used_count 读）。
export async function countServerBookmarks(): Promise<number> {
  try {
    const p = await getProfile();
    return p?.used_count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 确保 SW 中的 supabase 客户端持有有效 session。
 *
 * 背景：MV3 SW 与 popup/options 是独立 realm，各自创建 supabase 客户端实例。
 * 若 SW 在用户登录前已完成初始化（currentSession=null），之后 popup 登录写入
 * chrome.storage.local，但 SW 的 getSession() 因 initializePromise 已 resolve
 * 而直接返回内存中的 null——不会重新读 storage。BroadcastChannel 多标签同步
 * 在 SW 中不可靠（SW 可被回收 / 通道生命周期短）。
 *
 * 兜底：getSession() 为 null 时，直接从 storage 读取原始 session 并 setSession
 * 恢复。storage 里也没有才是真正的未登录。
 */
async function ensureSession(): Promise<Session | null> {
  const { data: sess } = await supabase.auth.getSession();
  if (sess?.session) return sess.session;
  try {
    // supabase 客户端把 storageKey 设为受保护成员（createStorageKey(url) 动态生成），
    // 原 JS 直接读运行时值；此处经窄边界 cast 取同一真实键，行为不变。
    const key = (supabase.auth as unknown as { storageKey: string }).storageKey;
    const raw = await api.storage.local.get(key);
    const stored = raw[key] as { access_token?: string; refresh_token?: string } | undefined;
    if (stored && stored.access_token && stored.refresh_token) {
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });
      if (!error && data.session) return data.session;
    }
  } catch {
    /* 兜底失败按未登录处理 */
  }
  return null;
}

// ---- 同步主入口 ----
// 返回 { ok, pushed, pulled, reason?, error? }
//
// 事件桥（registerLocalEventBridge）在 SW 顶层注册 chrome.bookmarks 监听，
// 本地变更 → coordinator 入队 → flushSoon 去抖推送；本函数负责周期/手动全量
// 同步：拉远端 → 播种（仅云端为空且本机未播种时）→ 推本地。
export async function runSync(_opts: unknown = {}): Promise<SyncRunResult> {
  const runGen = _coordinatorGen;
  try {
    // SW 冷启动 / 跨上下文登录态脱节：用 ensureSession 兜底，避免 popup 已登录
    // 但 SW 内存 session 为 null 时误报 not_authenticated。
    const sess = await ensureSession();
    if (!sess) {
      // 已知原因不附带 error 文案：展示层（store.reasonText）按 reason 码本地化，
      // 避免「请先在插件中登录 (请先在插件中登录)」式重复。
      return { ok: false, reason: 'not_authenticated' };
    }

    // B2「多容器并存」→「设备绑定空间」的一次性本机迁移（清掉残留的其它空间容器）
    await migrateFromMultiSpaceOnce();

    let { spaces, bound, stale } = await getBoundSpace();
    if (stale) {
      // 绑定的空间已被删除：不自动回落（那会在用户不知情时换掉同步目标），
      // 交给 UI 引导重新绑定。
      return { ok: false, reason: 'space_unbound' };
    }
    if (!bound) {
      // 本机从未绑定过 → 首绑（决策逻辑见 sync/binding.ts，有单测）。
      // 判据含「账号还能不能新建空间」：付费用户在新设备上应该拿到「加入旧的 /
      // 为本机新建」的选择；免费用户只有一个空间可加入，没得选就别打扰他。
      const canCreate = await planCanCreateSpace();
      switch (firstBindAction(spaces.length, false, canCreate)) {
        case 'create_default': {
          // 全新账号：没有空间可选，自动建「默认空间」并绑定（后端
          // bsync_space_create 首个空间自动 is_default=true）。
          // 空间名跟着界面语言走：它出现在空间列表与 quota 卡里，硬编码中文会让
          // 英文界面下冒出一个中文空间名。
          const r = await createSpace(t('spaces_defaultName'));
          if (!r.ok) return { ok: false, reason: 'no_space', error: r.error ?? t('err_noSpace') };
          ({ spaces } = await getBoundSpace());
          if (!spaces.length) return { ok: false, reason: 'no_space' };
          await bindSpace(spaces[0].id);
          bound = spaces[0];
          break;
        }
        case 'auto_bind':
          // 唯一空间且建不了新的：没得选，静默绑定（不拿必选页面打扰）。
          await bindSpace(spaces[0].id);
          bound = spaces[0];
          break;
        default:
          // 有真选择（≥2 个空间，或还能新建）：这台电脑加入哪个是**用户的决定**，
          // 交回 UI 挡出整页门禁。此处不绑定也不同步——绑定一旦写下，「本机从未
          // 绑定过」的事实就没了，用户再也没机会选（这正是本方案最容易踩的坑）。
          return {
            ok: false,
            reason: 'bind_needed',
            spaces: spaces.map((s) => ({ id: s.id, name: s.name, is_default: !!s.is_default })),
          };
      }
    }
    const active = bound;

    const deviceId = await getDeviceId();
    const key = await keyManager.ensureKey();
    if (!key) {
      // 不再自动生成随机密钥：必须由用户设置口令派生。无密钥时直接拒绝同步，
      // 由 UI 引导用户在口令门禁页输入口令（文案按 reason 码在展示层本地化）。
      return { ok: false, reason: 'no_key' };
    }

    // 设备心跳（0033：新设备首次登记超计划上限时服务端 raise device_limit_reached）
    const { error: touchError } = await supabase.rpc('bsync_device_touch', {
      p_space: active.id,
      p_device: deviceId,
      p_name: await detectDeviceName(),
    });
    if (touchError && String(touchError.message ?? '').includes('device_limit_reached')) {
      return { ok: false, reason: 'device_limit_reached', error: touchError.message };
    }

    // 绑定空间的映射桥 / 水位按空间分区：先确立活动桥（落地区恒为本环境原生
    // 根），事件处理器与 capture/reverseApply 后续都取它。
    await ensureActiveBridge(active);

    const coordinator = await getCoordinator(active.id, deviceId, key);
    console.log(
      `[bsync] === 同步开始 === space=${active.id} device=${deviceId} afterId=${coordinator.afterId} bare=${coordinator.replica.isBare()}`,
    );

    // 冷启动保护：MV3 SW 闲置终止后重建的 replica 只有固定根（isBare），
    // 或持有 outbox 恢复的 op（needsColdReplay，同样只有部分状态）。此时
    // 必须先从基线恢复，否则 reverseApply 的空/缺历史 CRDT 视图会把本机
    // 书签树当「已删除」清空（removeTrashedNodes 误删）。基线优先取 GC
    // 快照（快照存在且可用 → 重建 + 增量；op 已被截断时 pullFrom(0) 会漏
    // 行）；无快照时退回全量重放 pullFrom(0)。
    // 累计本次同步所有阶段的解密失败（冷启动重放 + 主 pull），
    // 统一用于：是否跳过 used_count 上报、是否在 popup 显示警告。
    const allDecryptErrors: PullOutcome['decryptErrors'] = [];

    // 记录本次同步开始时本机是否还没有云端水位（afterId=0）。
    // 若随后从云端拉到了历史数据，这是「新设备首次从云端恢复书签」，
    // 而不是「其他设备新增了变更」——文案要区分。
    const hadNoWatermark = coordinator.afterId === 0;

    if (coordinator.afterId > 0 && coordinator.needsColdReplay) {
      const replay = await coordinator.pullWithSnapshot(true);
      if (replay.applied > 0)
        await api.storage.local.set({ [afterIdKey(active.id)]: coordinator.afterId });
      if (replay.decryptErrors?.length) allDecryptErrors.push(...replay.decryptErrors);
      console.log(
        `[bsync] 冷启动重放: applied=${replay.applied} decryptErrors=${replay.decryptErrors?.length ?? 0} afterId=${coordinator.afterId}`,
      );
    }

    // 1) 拉远端 → 本地 CRDT（快照优先：快照新于本地水位时重建 + 增量）
    const pull = await coordinator.pullWithSnapshot(false);
    if (pull.decryptErrors?.length) allDecryptErrors.push(...pull.decryptErrors);
    console.log(
      `[bsync] 拉取: applied=${pull.applied} skipped=${pull.skipped ?? 0} decryptErrors=${pull.decryptErrors?.length ?? 0} afterId=${coordinator.afterId}`,
    );
    if (pull.decryptErrors?.length)
      console.log('[bsync]   解密失败行:', JSON.stringify(pull.decryptErrors));

    // 诊断：解密失败（密钥不匹配）时持久化详情，popup 可展示警告
    if (allDecryptErrors.length) {
      await api.storage.local.set({
        lastDecryptErrors: { errors: allDecryptErrors.slice(0, 5), at: Date.now() },
      });
    } else {
      await api.storage.local.remove('lastDecryptErrors');
    }

    // 1.5) afterId 自愈：拉取 0 条但水位 > 0，可能是数据库被清空过
    // （op id 从 1 重新开始，但本机/ SW coordinator 还持有旧水位）→ 探测云端，
    // 有数据则重置水位全量重拉，否则 CRDT 为空会误报 used=0 覆盖云端额度。
    if (pull.applied === 0 && coordinator.afterId > 0) {
      try {
        // 只有云端最大 op id < 本地 afterId 时，才说明数据库被清空过（序列重置）。
        // 不能只看 count>0：PostgreSQL 序列不随 DELETE 重置，新 op id 可能远大于 afterId。
        const { data: maxRow } = await supabase
          .from('bsync_op_log')
          .select('id')
          .eq('space_id', active.id)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();
        const maxId = maxRow?.id ?? 0;
        if (maxId > 0 && maxId < coordinator.afterId) {
          console.log(
            `[bsync] afterId 自愈: 远端最大 id=${maxId} < 本地 afterId=${coordinator.afterId}，重置为 0`,
          );
          coordinator.afterId = 0;
          const rePull = await coordinator.pullWithSnapshot(false);
          if (rePull.decryptErrors?.length) allDecryptErrors.push(...rePull.decryptErrors);
          pull.applied = rePull.applied;
        }
      } catch {
        /* 探测失败不阻塞 */
      }
    }

    // 空间已在本次同步途中被换绑（用户在同步进行中点了换绑 / 换了密钥）：
    // 立刻停手。继续跑下去，后面的 ensureActiveBridge 会把「活动映射桥」重新
    // 指回旧空间——而本机书签此时已被清空、正由新空间的同步重建，两边的投影
    // 会互相覆盖。旧空间的 op 已由 rebindSpace 落盘 + 推完，不会丢。
    if (runGen !== _coordinatorGen) {
      console.log('[bsync] 同步途中空间已切换，放弃本轮投影');
      return { ok: true, pushed: 0, pulled: pull.applied, superseded: true };
    }

    // 2) 重扫描本地树（每轮执行，幂等）：为未映射节点补建 MoveOp。
    //    替代旧「仅云端为空时播种」——批量导入中途关浏览器、事件被静默丢弃
    //    （父未映射/未设口令窗口/SW 冷启动竞态）、第二台设备本地书签（云端
    //    非空时旧实现不播种），这些孤儿在旧实现下永不同步。重扫描让「任一
    //    设备有而服务端没有的都保留」（并集合并）真正成立。
    //    didSeedThisRun 仅用于 UI 一次性提示（首台设备云端为空时的首次上传）。
    const captured = await captureLocalTree(coordinator, active);
    const didSeedThisRun = captured > 0 && hadNoWatermark && pull.applied === 0;
    if (captured > 0) {
      console.log(
        `[bsync] 本地重扫描: 补建 ${captured} 条 op, pending ops=${coordinator.pendingPushCount}`,
      );
    }

    // 3) 推本地 → 远端（播种/本地变更的 op 尽快推送，减少 SW 回收导致
    //    pendingPush 丢失的窗口；推送成功后再落盘计数器，防冷启动 seq 冲突）
    const pushed = await coordinator.flushPush();
    console.log(`[bsync] 推送: inserted=${pushed} counter=${coordinator.replica.counter}`);
    await api.storage.local.set({ [counterKey(active.id)]: coordinator.replica.counter });

    // 4) 反向应用：把合并后的 CRDT 可见树写回本机 chrome.bookmarks
    //    （远端新书签/移动/删除在本机生效；事件守卫防回环）
    const visTree = coordinator.replica.getVisibleTree();
    console.log(`[bsync] CRDT 可见树 (${visTree.length} 个节点)`);
    console.log(`[bsync] 开始反向应用 (decryptErrors=${allDecryptErrors.length})...`);
    await reverseApplyIntoChrome(coordinator, active);
    console.log('[bsync] 反向应用完成');

    // 5) op-log GC：服务端托管——push/pull 响应带 gc_needed（行数超过用户
    //    动态阈值或后台请求），客户端只需提供加密投影配合。阈值概念对用户
    //    不可见，插件内不再有任何 GC 设置。
    //
    //    数据安全守卫：GC 会把 ≤ 水位的历史 op 行截断为一份快照。若本次同步
    //    存在解密失败（冷启动重放 / 主拉取 / 快照重建任一来源），replica 不
    //    完整，快照会缺这些 op 的内容，截断后即永久丢失（密钥不匹配 / 改密
    //    钥迁移场景）。有解密失败时跳过本次 GC，等正确密钥设备重拉补齐后再
    //    压缩；协调器层的 replicaIncomplete 守卫兜底（换密钥重建实例前有效）。
    if (coordinator.gcNeeded && (pushed > 0 || pull.applied > 0)) {
      if (allDecryptErrors.length > 0) {
        console.warn(
          `[bsync] 跳过 GC：${allDecryptErrors.length} 条解密失败，replica 不完整（防止快照丢失数据）`,
        );
        await api.storage.local.set({
          lastGcSkipped: {
            reason: 'decrypt_failed',
            errors: allDecryptErrors.length,
            at: Date.now(),
          },
        });
      } else {
        try {
          const gc = await coordinator.maybeGc();
          if (gc.gced) {
            await api.storage.local.set({ lastGcAt: Date.now() });
            await api.storage.local.remove('lastGcSkipped');
          } else if (gc.reason === 'replica_incomplete') {
            // 协调器层守卫兜底（如快照基线解不开）：同样不生成投影
            console.warn('[bsync] 跳过 GC：replica 不完整（快照基线不可用）');
            await api.storage.local.set({
              lastGcSkipped: { reason: 'replica_incomplete', at: Date.now() },
            });
          }
        } catch {
          /* GC 失败不阻塞同步 */
        }
      }
    }

    // 6) 上报本机书签数（服务端 used_count 口径：快照加密后服务端无法自算）
    // 关键：pull 有解密失败时 CRDT 不完整，绝不能上报 used=0 覆盖之前的正确值——
    // 否则用户会看到额度从 N/500 跳成 0/500。
    if (allDecryptErrors.length) {
      console.log(
        `[bsync] 跳过 used_count 上报 (${allDecryptErrors.length} 条解密失败, CRDT 不完整)`,
      );
      await api.storage.local.set({
        lastUsedReport: {
          skipped: true,
          reason: 'decrypt_failed',
          visibleNodes: coordinator.replica.getVisibleTree().length,
          at: Date.now(),
        },
      });
    } else {
      try {
        let used = 0;
        const visible = coordinator.replica.getVisibleTree();
        for (const edge of visible) {
          if (typeof edge.meta?.url === 'string' && edge.meta.url) used++;
        }
        console.log(`[bsync] 上报 used_count=${used} (visibleNodes=${visible.length})`);
        await supabase.rpc('bsync_profile_set_used', { p_used: used });
        await api.storage.local.set({
          lastUsedReport: { used, visibleNodes: visible.length, at: Date.now() },
        });
      } catch (e) {
        try {
          await api.storage.local.set({
            lastUsedReportError: (e as { message?: unknown })?.message ?? String(e),
          });
        } catch {}
      }
    }

    // 密钥变更（resetCoordinator 递增 gen）后，旧同步的 afterId 不能写回——
    // 否则会覆盖刚清空的水位，导致新密钥下仍拉取 0 条。
    if (runGen === _coordinatorGen) {
      await api.storage.local.set({ [afterIdKey(active.id)]: coordinator.afterId });
    }
    // restored：本机原本无云端水位（新设备/换设备），本次从云端拉到了历史书签。
    // 这不是「其他设备新增变更」，而是把云端已有书签恢复到本机——文案要单独说。
    const restored = hadNoWatermark && pull.applied > 0 && !didSeedThisRun;
    return {
      ok: true,
      pushed,
      pulled: pull.applied,
      seeded: didSeedThisRun,
      restored,
      decryptFailed: allDecryptErrors.length,
    };
  } catch (e) {
    // 服务端语义码直接作为 reason（push/pull 抛出的 PostgREST 错误 message
    // 即服务端 raise 的码：0032 quota_exceeded / rate_limited，0033 device_limit_reached），
    // 由 store.js 映射为按档位区分的升级 / 清理指引。
    const msg = String((e as { message?: unknown })?.message ?? e);
    for (const code of ['quota_exceeded', 'rate_limited', 'device_limit_reached']) {
      if (msg.includes(code)) {
        try {
          await api.storage.local.set({ lastSyncError: msg });
        } catch {}
        // 语义码不是崩溃，是**产品信号**（配额触顶频率 ≈ 升级意愿）→ 单独记 reason
        void reportError('sync', code, e, { handled: true });
        return { ok: false, reason: code, error: msg };
      }
    }
    // 诊断：持久化完整错误与堆栈（readStorageLocal 可读）
    const detail = describeError(e);
    try {
      await api.storage.local.set({ lastSyncError: `${detail} | ${(e as Error)?.stack ?? ''}` });
    } catch {}
    void reportError('sync', 'error', e);
    return { ok: false, reason: 'error', error: detail };
  }
}

// ---- 事件桥接线（background.js 顶层调用）----
// MV3 要求 chrome.* 事件监听在 SW 顶层注册；coordinator 未就绪（未登录/无空间）
// 时事件安全跳过，下次 runSync 的重扫描兜底。
let bridgeRegistered = false;
let _coordinator: SyncCoordinator | null = null; // 惰性单例（按 spaceId 缓存）
let _coordinatorGen = 0; // 递增世代：resetCoordinator 后旧 boot 不再覆盖单例
let _eventGuard: { suppressed: { value: boolean } } = { suppressed: { value: false } }; // captureLocalEvents 返回的 suppressed 标志

export function registerLocalEventBridge(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  // 映射桥按空间多变，事件处理器经 getter 取「当前活动空间」的映射表
  // （bootCoordinatorForEvent 解析出空间时会一并确立 _activeBridge）。
  const bridgeGetter = () => getActiveBridge();
  // 冷启动防丢事件：coordinator 未就绪（SW 刚被事件唤醒、runSync 尚未跑）时
  // 懒启动一个 coordinator，而不是静默丢弃本地事件。否则 SW 冷窗口内的删除
  // 不产生墓碑，「立即同步」的全量重放会把已删除节点拉回来。
  // MV3 声明了 bookmarks 权限，SW 中 globalThis.chrome.bookmarks 恒存在。
  _eventGuard = captureLocalEvents(
    nativeBookmarks() as ChromeBookmarksAPI,
    () => getCoordinatorCached() ?? bootCoordinatorForEvent(),
    bridgeGetter,
    flushSoon,
  );
}

/** 惰性单例：事件到达时 coordinator 未创建 → 启动一个（登录态 + 空间 + 密钥）。 */
let _bootPromise: Promise<SyncCoordinator | null> | null = null;
function bootCoordinatorForEvent(): SyncCoordinator | null | Promise<SyncCoordinator | null> {
  if (_coordinator) return _coordinator;
  if (!_bootPromise) {
    _bootPromise = (async (): Promise<SyncCoordinator | null> => {
      const gen = _coordinatorGen;
      try {
        // 冷启动防丢事件：SW 刚被事件唤醒时 supabase session 是异步从
        // storage 恢复的（与 runSync 3afd01d 同一问题）。不先确认 session，
        // getBoundSpace 会用 anon 查询被 RLS 拦 → bound=null → 事件被丢
        // （典型表现：Firefox 闲置终止后再建书签，同步时该书签不出现）。
        const sess = await ensureSession();
        if (!sess) {
          return null; // 未登录：无可同步对象，事件跳过是正确行为
        }
        await migrateFromMultiSpaceOnce();
        const { bound: active } = await getBoundSpace();
        if (!active) return null; // 未登录/无空间：无可同步对象，事件跳过是正确行为
        const deviceId = await getDeviceId();
        const key = await keyManager.ensureKey();
        if (!key) return null; // 未设置口令：事件跳过，等用户设置后同步兜底
        if (gen !== _coordinatorGen) return null; // 密钥已变更，放弃本次 boot
        // 先确立该空间的落地区与映射桥：事件处理器随后经 getActiveBridge() 取用，
        // 否则冷启动窗口内的事件会拿不到映射而漏掉（典型：删除事件丢墓碑）。
        // 只传空间本身——B2 时代这里多传了个 `spaces` 列表，D 方案把那批变量删掉后
        // 参数没跟着删，`spaces is not defined` 被下面的 catch 吞成 return null，
        // 于是**每次 SW 冷启动后的本地事件全部丢弃**（正是本函数要防的那个 bug）。
        await ensureActiveBridge(active);
        return await getCoordinator(active.id, deviceId, key);
      } catch {
        return null; // 网络/权限失败：本事件放弃，下轮 runSync 兜底
      } finally {
        _bootPromise = null;
      }
    })();
  }
  return _bootPromise;
}

/**
 * 反向应用：把合并后的 CRDT 可见树写回 chrome.bookmarks（远端→本机）。
 *
 * 只写绑定空间的落地树 = 本环境原生根（本机书签树 ≡ 绑定空间）。映射按空间
 * 隔离：不属于本空间的节点在本桥里「无映射」，reverseApply 因此不会碰它们。
 */
async function reverseApplyIntoChrome(
  coordinator: SyncCoordinator,
  space: SpaceInfo,
): Promise<void> {
  const chrome = nativeBookmarks();
  if (!chrome) return;
  const bridge = await ensureActiveBridge(space);
  const guard = _eventGuard ?? { suppressed: { value: false } };
  // 注意：事件闭包读的是 guard.suppressed.value（captureLocalEvents 返回
  // { suppressed: {value} }），直接设 guard.value 会静默失效——这正是
  // reverseApply 回环（每次同步复制一批书签）的根因。
  guard.suppressed.value = true; // 抑制事件回环（create/move/update 会触发 onCreated 等）
  try {
    if (!IS_FIREFOX) {
      // Chromium：MENU_UUID 容器按需存在（原生根里没有「书签菜单」这个位置，
      // 只能挂在书签栏下）。仅当 CRDT 中「书签菜单」有实际子节点（Firefox
      // 菜单有书签并同步过来）时才创建。
      const menuHasChildren = coordinator.replica
        .getVisibleTree()
        .some((e) => e.parent === MENU_UUID);
      if (menuHasChildren) {
        await ensureMenuFolder(coordinator, bridge);
      }
    }
    // 回退文件夹名走 i18n：根下浏览器内部永久文件夹（历史脏 op）在本机没有
    // 映射时，会在「其他书签」下建一个同名文件夹承载它的整棵子树
    // （见 chromeBridge.ensureRootFallback）。名字跟着界面语言走。
    await reverseApply(chrome, coordinator, bridge, {
      fallbackRootTitle: t('sync_recoveredRoot'),
    });
    if (!IS_FIREFOX) {
      // 同步收敛后：若「书签菜单」容器已空，移除容器，让 Chrome 端只在
      // Firefox 菜单有书签时显示它。
      await cleanupEmptyMenuContainer(bridge);
    }
    await api.storage.local.set({ [idmapKey(space.id)]: bridge.snapshot() });
  } finally {
    guard.suppressed.value = false;
  }
}

/**
 * Chromium 端 MENU_UUID 容器：仅在 CRDT 中「书签菜单」有子节点时被调用
 * （reverseApplyIntoChrome 按需触发）。创建「书签菜单」文件夹并绑定
 * MENU_UUID；容器被删/重装后在此补建。菜单内容清空后由
 * cleanupEmptyMenuContainer 移除容器。
 */
async function ensureMenuFolder(coordinator: SyncCoordinator, bridge: IdBridge): Promise<void> {
  if (IS_FIREFOX) return; // Firefox 端 menu________ 是原生根，无需容器
  const chrome = nativeBookmarks();
  if (!chrome) return;
  const saved = await api.storage.local.get(MENU_FOLDER_KEY);
  const savedId = saved[MENU_FOLDER_KEY] as string | undefined;
  if (savedId) {
    try {
      const nodes = await chrome.get(savedId);
      if (nodes && nodes[0] && nodes[0].id === savedId) return; // 仍在
    } catch {
      /* 已被删除 → 重建 */
    }
  }
  const created = await chrome.create({ parentId: '1', title: MENU_FOLDER_TITLE });
  bridge.map(created.id, MENU_UUID);
  await api.storage.local.set({ [MENU_FOLDER_KEY]: created.id });
}

/**
 * Chromium 端空菜单容器清理：reverseApply 收敛后，若「书签菜单」容器存在
 * 但已无子节点（CRDT 中 MENU_UUID 无内容），删除容器并清空映射，避免 Chrome
 * 端出现无意义的空文件夹。容器内仍有 chrome 子节点时跳过（可能是尚未同步
 * 的本地书签，数据安全优先，留待下轮收敛后再删）。
 */
async function cleanupEmptyMenuContainer(bridge: IdBridge): Promise<void> {
  if (IS_FIREFOX) return; // Firefox 端 menu________ 是原生根，不可删
  const chrome = nativeBookmarks();
  if (!chrome) return;
  const saved = await api.storage.local.get(MENU_FOLDER_KEY);
  const savedId = saved[MENU_FOLDER_KEY] as string | undefined;
  if (!savedId) return;
  try {
    const nodes = await chrome.get(savedId);
    const node = nodes && nodes[0];
    if (!node || node.id !== savedId) {
      // 容器已不存在：清掉过期记录
      await api.storage.local.remove(MENU_FOLDER_KEY);
      return;
    }
    // 注意：chrome.bookmarks.get(id) 返回的单节点不含 children 字段，
    // 用 node.children 判断会恒为 0 → 每次都把非空容器当空容器删掉。
    // 必须用 getChildren(id) 取真实子节点数。
    const kids = await chrome.getChildren(savedId);
    if (kids.length > 0) return; // 仍有内容，保留
    await chrome.removeTree(savedId);
    await bridge.removeByChromeId(savedId);
    await api.storage.local.remove(MENU_FOLDER_KEY);
  } catch {
    /* 容器状态异常时忽略，下轮同步再处理 */
  }
}

function getCoordinatorCached(): SyncCoordinator | null {
  return _coordinator;
}

/** 获取（必要时创建）跨事件/同步共用的 coordinator 单例。 */
export async function getCoordinator(
  spaceId: string,
  deviceId: string,
  key: CryptoKey,
): Promise<SyncCoordinator> {
  if (_coordinator && _coordinator.spaceId === spaceId) return _coordinator;
  // 水位 / 计数器按空间分区（各空间各自续拉，互不覆盖）。
  const stored = await api.storage.local.get([afterIdKey(spaceId), counterKey(spaceId)]);
  const afterId = Number(stored[afterIdKey(spaceId)] ?? 0);
  // 冷启动恢复本设备已推送过的最大 seq：新 replica 的计数器从固定根（5）
  // 重新开始，若不恢复，首个本地 op（如删除墓碑）会与旧 SW 实例已推送的
  // (device, seq) 冲突，服务端 ON CONFLICT DO NOTHING 静默丢弃 → 删除失效。
  const initialCounter = Number(stored[counterKey(spaceId)] ?? 0);
  const transport = new SupabaseOpLogTransport(supabase);
  _coordinator = new SyncCoordinator({
    spaceId,
    deviceId,
    transport,
    key,
    afterId,
    initialCounter,
    onOpEnqueued: () => schedulePersist(),
    onChunkPushed: async (sid, seqs) => {
      try {
        (await getOutboxStore()).deleteSeqs(sid, seqs);
      } catch {
        /* 漏删由服务端 (space,device,seq) 幂等去重兜底 */
      }
    },
  });
  // SW 冷启动恢复：outbox 里未确认推送成功的本地 op 重放进 replica 并重回
  // 推送队列。没有这一步，推送失败/推送中 SW 被回收会让整批本地 op 丢失，
  // 而 IDMAP 已落盘——下一轮 reverseApply 会把「已映射但 CRDT 不可达」的
  // 书签从浏览器里删掉（批量导入的书签因此消失）。receiveOp 幂等。
  try {
    const rows = await (await getOutboxStore()).loadSpace(spaceId);
    if (rows.length > 0) {
      _coordinator.restoreOutbox(rows);
      console.log(`[bsync] outbox 恢复: ${rows.length} 条未确认 op 重新入队`);
    }
  } catch {
    /* IndexedDB 不可用：退回内存队列行为 */
  }
  return _coordinator;
}

// ── 本地变更持久化 tick ─────────────────────────────────────────────────
// 单一 300ms 去抖 tick 同时落盘三件事：outbox 未推送 op（IndexedDB）、
// IDMAP 快照（chromeId↔uuid）、Lamport counter。成对落盘是崩溃安全的关键：
// 若只有映射落盘而 op 丢失，「已映射但 CRDT 不可达」会让 reverseApply 把
// 本地书签误删；顺序固定为 outbox 先、IDMAP 后——残余崩溃窗口（亚毫秒级）
// 的最坏情况是重复书签（可恢复），绝不是数据丢失。
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistRunning = false;
function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, 300);
}

let _outboxStore: OutboxStore | null = null;
async function getOutboxStore(): Promise<OutboxStore> {
  if (!_outboxStore) {
    const db = await openBookmarkDb(globalThis.indexedDB);
    _outboxStore = new OutboxStore(db);
  }
  return _outboxStore;
}

async function flushPersist(): Promise<void> {
  if (persistRunning) return;
  persistRunning = true;
  try {
    const c = getCoordinatorCached();
    if (!c) return;
    const journal = c.peekPendingJournal();
    if (journal.length > 0) {
      try {
        const store = await getOutboxStore();
        await store.putOps(c.spaceId, journal);
        c.clearPendingJournal(journal);
      } catch {
        /* IndexedDB 不可用：退回内存队列行为，重扫描兜底 */
      }
    }
    // IDMAP / counter 按空间分区落盘（与 outbox 的 spaceId 维度一致）。
    const entry = _bridges.get(c.spaceId);
    await api.storage.local.set({
      [idmapKey(c.spaceId)]: entry ? entry.bridge.snapshot() : {},
      [counterKey(c.spaceId)]: c.replica.counter,
    });
  } catch {
    /* 持久化失败不阻塞同步 */
  } finally {
    persistRunning = false;
  }
}

/**
 * chromeId↔uuid 映射桥：**按空间一个实例**，内存 + chrome.storage.local
 * `crdt.idmap.<spaceId>` 持久化（重启不丢）。
 *
 * 为什么按空间分区：同一 chromeId 在不同空间是不同节点。与另一个空间的映射表
 * 混用会让「本机已有书签」在该空间里显示为「已映射但 CRDT 不可达」→
 * reverseApply 把它们全部 removeTree（本机书签被清空）。同一时刻本机只有一张
 * 表是活动的（绑定空间），换绑时该表整体作废并重建。
 *
 * 落地区恒为本环境原生根（本机书签树 ≡ 绑定空间）。
 */
const _bridges = new Map<string, { bridge: IdBridge; sig: string }>();
/** 事件桥使用的「当前绑定空间」映射表（runSync / 懒启动时确立）。 */
let _activeBridge: IdBridge | null = null;

/**
 * 建立（或复用）绑定空间的映射桥。
 *
 * 同一空间复用内存中的桥（保留映射）；换绑 / 重置后由 dropBridgeCache 清掉，
 * 下次按新空间重建并重新载入持久化映射。
 */
async function ensureActiveBridge(space: SpaceInfo): Promise<IdBridge> {
  const pairs = nativeRootPairs(IS_FIREFOX);
  const sig = JSON.stringify(pairs);
  const cached = _bridges.get(space.id);
  if (cached && cached.sig === sig) {
    _activeBridge = cached.bridge;
    return cached.bridge;
  }
  // 重建前先把旧桥的映射落盘，避免重建丢映射（下次 capture 会重复建节点）。
  if (cached) {
    try {
      await api.storage.local.set({ [idmapKey(space.id)]: cached.bridge.snapshot() });
    } catch {
      /* 落盘失败：重建后由 capture 兜底（最坏是重复节点，不会丢数据） */
    }
  }
  const bridge = new IdBridge(() => schedulePersist(), {
    spaceId: space.id,
    roots: pairs,
  });
  // 冷启动竞态修复：idMap 恢复是异步的，必须等 load 完成后再 reverseApply /
  // capture，否则映射缺失会让 reverseApply 把「已存在的书签」当「缺失」重复
  // 创建（SW 每次冷启动/回收后同步都复制一批书签）。
  try {
    const res = await api.storage.local.get(idmapKey(space.id));
    const map = res[idmapKey(space.id)] as Record<string, string> | undefined;
    if (map) bridge.load(map);
  } catch {
    /* storage 不可用：本轮按空映射处理 */
  }
  _bridges.set(space.id, { bridge, sig });
  _activeBridge = bridge;
  return bridge;
}

function getActiveBridge(): IdBridge | null {
  return _activeBridge;
}

/** 切换空间 / 重置后丢弃缓存的映射表（下次按新空间重建并重新载入）。 */
function dropBridgeCache(spaceId?: string): void {
  if (spaceId) _bridges.delete(spaceId);
  else _bridges.clear();
  _activeBridge = null;
}

/**
 * 重扫描本机 chrome 书签树：为未映射节点补建 op（每轮同步执行，幂等）。
 * 遍历核心在 chromeBridge.captureLocalTree（可独立测试）；此处负责映射载入，
 * 以及捕获结果的立即落盘——outbox 先、IDMAP 后（成对语义见 flushPersist
 * 注释），不等 300ms tick，避免大批量捕获的持久化空窗。
 *
 * 从本环境原生根起走（本机书签树 ≡ 绑定空间）。
 */
export async function captureLocalTree(
  coordinator: SyncCoordinator,
  space: SpaceInfo,
): Promise<number> {
  if (!space?.id) return 0;
  const bridge = await ensureActiveBridge(space);
  const bookmarks = nativeBookmarks();
  if (!bookmarks) return 0;
  const captured = await captureUnmappedTree(
    bookmarks,
    coordinator,
    bridge,
    nativeRootPairs(IS_FIREFOX)[0][0],
  );
  if (captured > 0) await flushPersist();
  return captured;
}

/** 事件入队后去抖 flush（2s），实现「自动无感同步」。 */
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SYNC_KEY = 'crdt.autoSync';
export function flushSoon(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      const c = getCoordinatorCached();
      if (!c) return;
      // 自动同步开关：关闭时本地变更继续入队，但不自动推送；
      // 手动 runSync / syncNow 不受此开关限制。
      const { [AUTO_SYNC_KEY]: auto } = await api.storage.local.get(AUTO_SYNC_KEY);
      if (auto === false) return;
      // 推送前先落盘计数器：即使推送后 SW 立刻被回收，下次冷启动恢复的
      // 计数器也覆盖了这批 op 的 seq（防与历史 seq 冲突被服务端静默丢弃）。
      await api.storage.local.set({ [counterKey(c.spaceId)]: c.replica.counter });
      const pushed = await c.flushPush();
      await api.storage.local.set({ [afterIdKey(c.spaceId)]: c.afterId });
      if (pushed > 0) {
        // 自动推送只记录时间和条数，不覆盖 lastSyncStatus——
        // 否则手动同步的「推送 0 条」会覆盖自动推送的「推送 N 条」，
        // 用户看到状态在 1 和 0 之间跳变，以为数据丢了。
        await api.storage.local.set({ lastAutoPushAt: Date.now(), lastAutoPushCount: pushed });
      }
    } catch {
      /* 推送失败时 op 保留在 pendingPush，下轮 runSync / flushSoon 重试 */
    }
  }, 2000);
}

// 简易设备名：从 UA 推断浏览器 + 平台。
async function detectDeviceName(): Promise<string> {
  try {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : '浏览器';
    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Mac OS/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
    return [browser, os].filter(Boolean).join(' · ');
  } catch {
    return '设备';
  }
}

// ── 密钥变更后重置 coordinator（让下次同步用新密钥重建）──────────────────
// 导入密钥 / 用口令设置密钥后，SyncCoordinator 内存中仍缓存旧 CryptoKey，
// 必须置空单例，下次 bootCoordinatorForEvent 会用 storage 中的新密钥重建。
export function resetCoordinator(): void {
  _coordinatorGen++;
  _coordinator = null;
  _bootPromise = null;
  _activeBridge = null;
  // 密钥变更后清空水位：之前密钥错误时被跳过的 op（afterId 已推进）必须重拉，
  // 否则新设备导入密钥后拉取 0 条、CRDT 为空、误报 used=0 覆盖云端额度。
  // 水位按空间分区，故清掉全部空间的。
  removeAllScoped(AFTER_ID_PREFIX).catch(() => {});
}

// ── 测试工具：一键重置同步状态（保留登录态）──────────────────────────────
// 清除本机所有同步相关缓存（CRDT 计数器/水位/UUID映射/绑定空间/密钥/播种标记
// 等），并重置内存中的 coordinator 单例。不会删除 chrome.bookmarks 里的书签，
// 也不会登出 Supabase 账号。配合「清空云端测试数据」使用，可从零重测。
//
// 注意：重置后本机绑定空间不再登记，下次同步会重新绑定默认空间并把云端书签
// 重新投影进来；本机原有书签会被重新捕获成新节点（重置的本质就是从零重测）。
export async function resetSyncState(): Promise<void> {
  _coordinator = null;
  _coordinatorGen++;
  dropBridgeCache();
  const keys = [
    DEVICE_ID_KEY,
    LEGACY_SPACE_ROOTS_KEY,
    'crdt.seeded',
    MENU_FOLDER_KEY,
    GC_THRESHOLD_KEY,
    BOUND_SPACE_KEY,
    SPACE_MIGRATED_KEY,
    'crdt.e2eeKey',
    'crdt.e2eeSalt',
    'crdt.onboardSkipped',
    'lastSyncStatus',
    'lastSyncAt',
    'lastSyncError',
    'lastDecryptErrors',
    'lastUsedReport',
    'lastUsedReportError',
    'lastGcAt',
    'lastGcSkipped',
    'activeSpace',
    LEGACY_ACTIVE_SPACE_KEY,
    ...LEGACY_KEYS,
  ];
  await api.storage.local.remove(keys);
  // 按空间分区的键（水位/计数器/映射）：逐前缀清理
  await removeAllScoped(AFTER_ID_PREFIX);
  await removeAllScoped(COUNTER_PREFIX);
  await removeAllScoped(IDMAP_PREFIX);
  // 清除 IndexedDB 中的 CRDT 持久化状态（ops/snapshot/uuidMapping/meta）
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('bookmark-crdt-sync');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  } catch (e) {
    console.warn(
      '[bsync] resetSyncState: IndexedDB 删除失败:',
      (e as { message?: unknown })?.message,
    );
  }
}
// 供测试：暴露内存传输 + 协调器类型（避免重复实例化）。
export { MemoryOpLogTransport };
