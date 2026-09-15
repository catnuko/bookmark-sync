// 书签同步引擎 v2 —— Move-CRDT 操作日志模型（Phase C-2）
// ------------------------------------------------------------------
// 取代旧的「真树快照 + 三态基线合并」。本文件是面向 App.vue / background 的
// 薄封装：
//   - 数据面：src/sync/（SyncCoordinator + 操作日志 + 操作级 E2EE）
//   - 控制面：直接调用 0017 迁移里的 RPC（bsync_space_* / bsync_device_* /
//     bsync_get_profile / bsync_op_push / bsync_op_pull）
//
// CRDT 语义下，「合并」是自动的（并集收敛，不会丢书签、不会成环），所以旧
// 的首同步四象限决策在 v2 大幅简化：默认直接双向同步即可。
// ------------------------------------------------------------------

import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import {
  SupabaseOpLogTransport,
  SyncCoordinator,
  MemoryOpLogTransport,
  captureLocalEvents,
  IdBridge,
  reverseApply,
  computePosition,
} from "./sync/index.js";
import { KeyManager } from "./sync/index.js";
import { ROOT_UUID, MENU_UUID } from "./crdt/index.js";
import { IS_FIREFOX } from "./sync/index.js";

const DEVICE_ID_KEY = "crdt.deviceId";
const AFTER_ID_KEY = "crdt.afterId";
/** 本设备 Lamport 计数器（与 afterId 一起持久化，冷启动恢复防 seq 冲突）。 */
const COUNTER_KEY = "crdt.counter";
const IDMAP_KEY = "crdt.idmap";
const SEEDED_KEY = "crdt.seeded";
/** op-log GC 阈值（storage 键可覆盖；E2E 注入小阈值验证 GC 链路）。 */
const GC_THRESHOLD_KEY = "crdt.gcThreshold";
const DEFAULT_GC_THRESHOLD = 2000;

/** Chromium 端 MENU_UUID（书签菜单）动态容器的持久化 chromeId。 */
const MENU_FOLDER_KEY = "crdt.menuFolderId";
const MENU_FOLDER_TITLE = "书签菜单";

const keyManager = new KeyManager({
  async get(key) { return (await api.storage.local.get(key))[key]; },
  async set(key, value) { await api.storage.local.set({ [key]: value }); },
  async remove(key) { await api.storage.local.remove(key); },
});

// ---- 设备 ID（UUID，同时作为 CRDT replicaId）----
export async function getDeviceId() {
  const res = await api.storage.local.get(DEVICE_ID_KEY);
  if (res[DEVICE_ID_KEY]) return res[DEVICE_ID_KEY];
  const id = globalThis.crypto.randomUUID();
  await api.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

// ---- Profile / 空间 / 设备 控制面 ----
export async function getProfile() {
  const { data, error } = await supabase.rpc("bsync_get_profile");
  if (error) throw error;
  return data;
}

export async function getActiveSpace() {
  const { data, error } = await supabase
    .from("bsync_spaces")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  const spaces = data ?? [];
  const active = spaces.find((s) => s.is_default) ?? spaces[0] ?? null;
  return { spaces, active };
}

export async function createSpace(name) {
  const { data, error } = await supabase.rpc("bsync_space_create", { p_name: name });
  if (error) return { ok: false, error: error.message };
  return { ok: true, space: data };
}

export async function renameSpace(id, name) {
  const { error } = await supabase.rpc("bsync_space_rename", { p_space: id, p_name: name });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteSpace(id) {
  const { error } = await supabase.rpc("bsync_space_delete", { p_space: id });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function switchSpace(id) {
  // CRDT 模型下切换空间 = 切换本地 afterId 水位（不同 space 各自水位）。
  await api.storage.local.set({ activeSpaceId: id, [AFTER_ID_KEY]: 0 });
  return { ok: true };
}

export async function listDevices(spaceId) {
  const sid = spaceId ?? (await getActiveSpace()).active?.id;
  if (!sid) return [];
  const { data, error } = await supabase
    .from("bsync_devices")
    .select("*")
    .eq("space_id", sid)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  // 归一化到 App.vue 期望的字段名（v2 表是 id / last_seen_at）。
  return (data ?? []).map((d) => ({
    ...d,
    device_id: d.id,
    last_sync_at: d.last_seen_at,
  }));
}

export async function removeDevice(deviceId) {
  const { error } = await supabase.rpc("bsync_device_remove", { p_device: deviceId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// 服务端书签计数（v2：从 profile.used_count 读）。
export async function countServerBookmarks() {
  try {
    const p = await getProfile();
    return p?.used_count ?? 0;
  } catch {
    return 0;
  }
}

// ---- 首同步兼容占位（CRDT 自动收敛，无需用户决策）----
export async function acknowledgeFirstSync() { return { ok: true }; }
export async function pullOverwriteLocal() { return { ok: true }; }

// ---- 同步主入口 ----
// 返回 { ok, pushed, pulled, reason?, error? }
//
// 事件桥（registerLocalEventBridge）在 SW 顶层注册 chrome.bookmarks 监听，
// 本地变更 → coordinator 入队 → flushSoon 去抖推送；本函数负责周期/手动全量
// 同步：拉远端 → 播种（仅云端为空且本机未播种时）→ 推本地。
export async function runSync(_opts = {}) {
  try {
    // SW 冷启动时 supabase 客户端的 session 是异步从 storage 恢复的；
    // 不先确认就绪，RPC 会以 anon（无 JWT）执行 → auth.uid() 为 null
    // （线上 bsync_space_create 无认证检查时直接 INSERT owner_id NULL 报错）。
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session) {
      return { ok: false, reason: "not_authenticated", error: "请先在插件中登录" };
    }

    let { active } = await getActiveSpace();
    if (!active) {
      // 新用户无需手动建空间：首次同步自动创建「默认空间」（后端
      // bsync_space_create 首个空间自动 is_default=true）。后续推送/拉取
      // 以此为落点，老客户端行为不变。
      const r = await createSpace("默认空间");
      if (!r.ok) return { ok: false, reason: "no_space", error: r.error ?? "无法创建默认空间" };
      ({ active } = await getActiveSpace());
      if (!active) return { ok: false, reason: "no_space" };
    }

    const deviceId = await getDeviceId();
    const key = await keyManager.ensureKey();

    // 设备心跳
    await supabase.rpc("bsync_device_touch", {
      p_space: active.id,
      p_device: deviceId,
      p_name: await detectDeviceName(),
    });

    const coordinator = await getCoordinator(active.id, deviceId, key);

    // 冷启动保护：MV3 SW 闲置终止后重建的 replica 只有固定根（isBare），
    // 但云端已有历史。此时必须先从基线恢复，否则 reverseApply 的空 CRDT
    // 视图会把本机书签树当「已删除」清空（removeTrashedNodes 误删）。
    // 基线优先取 GC 快照（快照存在且可用 → 重建 + 增量；op 已被截断时
    // pullFrom(0) 会漏行）；无快照时退回全量重放 pullFrom(0)。
    if (coordinator.afterId > 0 && coordinator.replica.isBare()) {
      const replay = await coordinator.pullWithSnapshot(true);
      if (replay.applied > 0) await api.storage.local.set({ [AFTER_ID_KEY]: coordinator.afterId });
    }

    // 1) 拉远端 → 本地 CRDT（快照优先：快照新于本地水位时重建 + 增量）
    const pull = await coordinator.pullWithSnapshot(false);

    // 2) 播种：云端无历史 && 本机未播种过 → 把现有 chrome 书签树转成 MoveOp
    if (pull.applied === 0 && coordinator.afterId === 0) {
      await seedExistingTree(coordinator);
    }

    // 3) 反向应用：把合并后的 CRDT 可见树写回本机 chrome.bookmarks
    //    （远端新书签/移动/删除在本机生效；事件守卫防回环）
    await ensureBridgeReady(); // 冷启动：idMap 必须先恢复，否则 reverseApply 会重复建书签
    await reverseApplyIntoChrome(coordinator);

    // 4) 推本地 → 远端（推送前先落盘计数器，防冷启动 seq 冲突；push 失败
    //    时 op 留在 pendingPush，下轮同步重试，不会静默丢墓碑）
    await api.storage.local.set({ [COUNTER_KEY]: coordinator.replica.counter });
    const pushed = await coordinator.flushPush();

    // 5) op-log GC：本机树完整后，若服务端行数超阈值 → 落快照 + 截断。
    //    阈值来自 storage（E2E 用小阈值注入验证），默认 2000 行。
    const gcCfg = await api.storage.local.get(GC_THRESHOLD_KEY);
    const gcThreshold = Number(gcCfg[GC_THRESHOLD_KEY] ?? DEFAULT_GC_THRESHOLD);
    if (gcThreshold > 0 && (pushed > 0 || pull.applied > 0)) {
      try {
        const gc = await coordinator.maybeGc(gcThreshold);
        if (gc.gced) {
          await api.storage.local.set({ lastGcAt: Date.now() });
        }
      } catch { /* GC 失败不阻塞同步 */ }
    }

    // 6) 上报本机书签数（服务端 used_count 口径：快照加密后服务端无法自算）
    try {
      let used = 0;
      for (const edge of coordinator.replica.getVisibleTree()) {
        if (typeof edge.meta?.url === "string" && edge.meta.url) used++;
      }
      await supabase.rpc("bsync_profile_set_used", { p_used: used });
    } catch { /* 上报失败不阻塞 */ }

    await api.storage.local.set({ [AFTER_ID_KEY]: coordinator.afterId });
    return { ok: true, pushed, pulled: pull.applied, seeded: seededRef.value };
  } catch (e) {
    // 诊断：持久化完整错误与堆栈（readStorageLocal 可读）
    try {
      await api.storage.local.set({ lastSyncError: `${e?.message ?? e} | ${e?.stack ?? ''}` });
    } catch {}
    return { ok: false, reason: "error", error: e?.message ?? String(e) };
  }
}

// ---- 事件桥接线（background.js 顶层调用）----
// MV3 要求 chrome.* 事件监听在 SW 顶层注册；coordinator 未就绪（未登录/无空间）
// 时事件安全跳过，下次 runSync 的播种兜底。
let bridgeRegistered = false;
let _coordinator = null; // 惰性单例（按 spaceId 缓存）
let _bridge = null;
let _eventGuard = { suppressed: { value: false } }; // captureLocalEvents 返回的 suppressed 标志
const seededRef = { value: false };

export function registerLocalEventBridge() {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  const bridge = getOrCreateBridge();
  // 冷启动防丢事件：coordinator 未就绪（SW 刚被事件唤醒、runSync 尚未跑）时
  // 懒启动一个 coordinator，而不是静默丢弃本地事件。否则 SW 冷窗口内的删除
  // 不产生墓碑，「立即同步」的全量重放会把已删除节点拉回来。
  _eventGuard = captureLocalEvents(
    globalThis.chrome?.bookmarks,
    () => getCoordinatorCached() ?? bootCoordinatorForEvent(),
    bridge,
    flushSoon,
  );
}

/** 惰性单例：事件到达时 coordinator 未创建 → 启动一个（登录态 + 空间 + 密钥）。 */
let _bootPromise = null;
function bootCoordinatorForEvent() {
  if (_coordinator) return _coordinator;
  if (!_bootPromise) {
    _bootPromise = (async () => {
      try {
        // 冷启动防丢事件：SW 刚被事件唤醒时 supabase session 是异步从
        // storage 恢复的（与 runSync 3afd01d 同一问题）。不先确认 session，
        // getActiveSpace 会用 anon 查询被 RLS 拦 → active=null → 事件被丢
        // （典型表现：Firefox 闲置终止后再建书签，同步时该书签不出现）。
        const { data: sess } = await supabase.auth.getSession();
        if (!sess?.session) {
          return null; // 未登录：无可同步对象，事件跳过是正确行为
        }
        const { active } = await getActiveSpace();
        if (!active) return null; // 未登录/无空间：无可同步对象，事件跳过是正确行为
        const deviceId = await getDeviceId();
        const key = await keyManager.ensureKey();
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

/** 反向应用：把合并后的 CRDT 可见树写回 chrome.bookmarks（远端→本机）。 */
async function reverseApplyIntoChrome(coordinator) {
  const chrome = globalThis.chrome?.bookmarks;
  if (!chrome) return;
  const bridge = getOrCreateBridge();
  const guard = _eventGuard ?? { suppressed: { value: false } };
  // 注意：事件闭包读的是 guard.suppressed.value（captureLocalEvents 返回
  // { suppressed: {value} }），直接设 guard.value 会静默失效——这正是
  // reverseApply 回环（每次同步复制一批书签）的根因。
  guard.suppressed.value = true; // 抑制事件回环（create/move/update 会触发 onCreated 等）
  try {
    if (!IS_FIREFOX) {
      // Chromium 端 MENU_UUID 容器按需存在：仅当 CRDT 中「书签菜单」有实际
      // 子节点（Firefox 菜单有书签并同步过来）时才创建容器；菜单为空或从未
      // 用过 Firefox 时，Chrome 端不显示「书签菜单」文件夹。
      const menuHasChildren = coordinator.replica
        .getVisibleTree()
        .some((e) => e.parent === MENU_UUID);
      if (menuHasChildren) {
        await ensureMenuFolder(coordinator, bridge);
      }
    }
    await reverseApply(chrome, coordinator, bridge);
    if (!IS_FIREFOX) {
      // 同步收敛后：若「书签菜单」容器已空（CRDT 中 MENU_UUID 无内容），
      // 移除空容器，让 Chrome 端只在 Firefox 菜单有书签时显示它。
      await cleanupEmptyMenuContainer(bridge);
    }
    await api.storage.local.set({ [IDMAP_KEY]: bridge.snapshot() });
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
async function ensureMenuFolder(coordinator, bridge) {
  if (IS_FIREFOX) return; // Firefox 端 menu________ 是原生根，无需容器
  const chrome = globalThis.chrome?.bookmarks;
  if (!chrome) return;
  const saved = await api.storage.local.get(MENU_FOLDER_KEY);
  const savedId = saved[MENU_FOLDER_KEY];
  if (savedId) {
    try {
      const nodes = await chrome.get(savedId);
      if (nodes && nodes[0] && nodes[0].id === savedId) return; // 仍在
    } catch { /* 已被删除 → 重建 */ }
  }
  const created = await chrome.create({ parentId: "1", title: MENU_FOLDER_TITLE });
  bridge.map(created.id, MENU_UUID);
  await api.storage.local.set({ [MENU_FOLDER_KEY]: created.id });
}

/**
 * Chromium 端空菜单容器清理：reverseApply 收敛后，若「书签菜单」容器存在
 * 但已无子节点（CRDT 中 MENU_UUID 无内容），删除容器并清空映射，避免 Chrome
 * 端出现无意义的空文件夹。容器内仍有 chrome 子节点时跳过（可能是尚未同步
 * 的本地书签，数据安全优先，留待下轮收敛后再删）。
 */
async function cleanupEmptyMenuContainer(bridge) {
  if (IS_FIREFOX) return; // Firefox 端 menu________ 是原生根，不可删
  const chrome = globalThis.chrome?.bookmarks;
  if (!chrome) return;
  const saved = await api.storage.local.get(MENU_FOLDER_KEY);
  const savedId = saved[MENU_FOLDER_KEY];
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

function getCoordinatorCached() {
  return _coordinator;
}

/** 获取（必要时创建）跨事件/同步共用的 coordinator 单例。 */
export async function getCoordinator(spaceId, deviceId, key) {
  if (_coordinator && _coordinator.spaceId === spaceId) return _coordinator;
  const stored = await api.storage.local.get([AFTER_ID_KEY, COUNTER_KEY]);
  const afterId = Number(stored[AFTER_ID_KEY] ?? 0);
  // 冷启动恢复本设备已推送过的最大 seq：新 replica 的计数器从固定根（5）
  // 重新开始，若不恢复，首个本地 op（如删除墓碑）会与旧 SW 实例已推送的
  // (device, seq) 冲突，服务端 ON CONFLICT DO NOTHING 静默丢弃 → 删除失效。
  const initialCounter = Number(stored[COUNTER_KEY] ?? 0);
  const transport = new SupabaseOpLogTransport(supabase);
  _coordinator = new SyncCoordinator({ spaceId, deviceId, transport, key, afterId, initialCounter });
  return _coordinator;
}

/** chromeId↔uuid 映射桥：内存 + chrome.storage.local 持久化（重启不丢）。 */
let persistTimer = null;
let _idMapReady = null; // Promise：idMap / seeded 标志从 storage 恢复完成

function getOrCreateBridge() {
  if (_bridge) return _bridge;
  _bridge = new IdBridge(() => {
    // 持久化快照（防抖到微任务避免高频写）
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      api.storage.local.set({ [IDMAP_KEY]: _bridge.snapshot() }).catch(() => {});
    }, 300);
  });
  // 冷启动竞态修复：idMap 恢复是异步的，必须等 load 完成后再 reverseApply /
  // seedExistingTree，否则映射缺失会让 reverseApply 把「已存在的书签」当
  // 「缺失」重复创建（SW 每次冷启动/回收后同步都复制一批书签）。
  _idMapReady = (async () => {
    const [idmap, seeded] = await Promise.all([
      api.storage.local.get(IDMAP_KEY),
      api.storage.local.get(SEEDED_KEY),
    ]);
    if (idmap[IDMAP_KEY]) _bridge.load(idmap[IDMAP_KEY]);
    seededRef.value = !!seeded[SEEDED_KEY];
  })().catch(() => {});
  return _bridge;
}

/** 等待 idMap / seeded 标志恢复完成（reverseApply / 播种前必须 await）。 */
async function ensureBridgeReady() {
  if (_idMapReady) await _idMapReady;
}

/**
 * 播种：把现有 chrome 书签树转成一批 MoveOp（仅首设备/云端空时调用）。
 * 幂等：已映射的 chromeId 跳过；未映射的生成 uuid 并 createNodeWithId。
 */
export async function seedExistingTree(coordinator) {
  if (seededRef.value) return { seeded: false };
  const bridge = getOrCreateBridge();
  await ensureBridgeReady(); // 已映射判断依赖 idMap 恢复完成
  if (!globalThis.chrome?.bookmarks) return { seeded: false, reason: "no-chrome-bookmarks" };
  const tree = await globalThis.chrome.bookmarks.getTree();
  let seeded = 0;
  const walk = async (node, parentUuid) => {
    const existing = bridge.toUuid(node.id);
    if (existing) {
      // 固定根（Chrome "0".."3" / Firefox root/menu/toolbar/unfiled/mobile）
      // 直接续走子树：它们不产生新 op，其下用户节点正常播种
      for (const child of node.children ?? []) await walk(child, existing);
      return;
    }
    const uuid = globalThis.crypto.randomUUID();
    bridge.map(node.id, uuid);
    const meta = { title: node.title, ...(node.url ? { url: node.url } : {}) };
    // 按 Chrome 实际 index 生成 fractional position（与 onCreated 一致：
    // 首次导入也保留用户已有的顺序，而不是同步后被 uuid 序覆盖）
    const pos = computePosition(coordinator, parentUuid, node.index ?? 0, null);
    if (pos !== null) meta.position = pos;
    coordinator.createNodeWithId(uuid, parentUuid, meta);
    seeded++;
    for (const child of node.children ?? []) await walk(child, uuid);
  };
  for (const root of tree ?? []) await walk(root, ROOT_UUID);
  await api.storage.local.set({ [SEEDED_KEY]: true });
  seededRef.value = true;
  await api.storage.local.set({ [IDMAP_KEY]: bridge.snapshot() });
  return { seeded };
}

/** 事件入队后去抖 flush（2s），实现「自动无感同步」。 */
let flushTimer = null;
export function flushSoon() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      const c = getCoordinatorCached();
      if (!c) return;
      // 推送前先落盘计数器：即使推送后 SW 立刻被回收，下次冷启动恢复的
      // 计数器也覆盖了这批 op 的 seq（防与历史 seq 冲突被服务端静默丢弃）。
      await api.storage.local.set({ [COUNTER_KEY]: c.replica.counter });
      const pushed = await c.flushPush();
      await api.storage.local.set({ [AFTER_ID_KEY]: c.afterId });
      if (pushed > 0) {
        await api.storage.local.set({ lastSyncAt: Date.now(), lastSyncStatus: `推送 ${pushed} 条` });
      }
    } catch { /* 推送失败时 op 保留在 pendingPush，下轮 runSync / flushSoon 重试 */ }
  }, 2000);
}

// 简易设备名：从 UA 推断浏览器 + 平台。
async function detectDeviceName() {
  try {
    const ua = navigator.userAgent;
    const browser =
      /Edg\//.test(ua) ? "Edge" :
      /OPR\//.test(ua) ? "Opera" :
      /Chrome\//.test(ua) ? "Chrome" :
      /Firefox\//.test(ua) ? "Firefox" : "浏览器";
    const os =
      /Windows/.test(ua) ? "Windows" :
      /Mac OS/.test(ua) ? "macOS" :
      /Android/.test(ua) ? "Android" :
      /Linux/.test(ua) ? "Linux" : "";
    return [browser, os].filter(Boolean).join(" · ");
  } catch {
    return "设备";
  }
}

// 供测试：暴露内存传输 + 协调器类型（避免重复实例化）。
export { MemoryOpLogTransport };
