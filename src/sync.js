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
} from "./sync/index.js";
import { KeyManager } from "./sync/index.js";
import { ROOT_UUID } from "./crdt/index.js";

const DEVICE_ID_KEY = "crdt.deviceId";
const AFTER_ID_KEY = "crdt.afterId";
const IDMAP_KEY = "crdt.idmap";
const SEEDED_KEY = "crdt.seeded";

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
    const { active } = await getActiveSpace();
    if (!active) return { ok: false, reason: "no_space" };

    const deviceId = await getDeviceId();
    const key = await keyManager.ensureKey();

    // 设备心跳
    await supabase.rpc("bsync_device_touch", {
      p_space: active.id,
      p_device: deviceId,
      p_name: await detectDeviceName(),
    });

    const coordinator = await getCoordinator(active.id, deviceId, key);

    // 1) 拉远端 → 本地 CRDT
    const pull = await coordinator.pull();

    // 2) 播种：云端无历史 && 本机未播种过 → 把现有 chrome 书签树转成 MoveOp
    if (pull.applied === 0 && coordinator.afterId === 0) {
      await seedExistingTree(coordinator);
    }

    // 3) 反向应用：把合并后的 CRDT 可见树写回本机 chrome.bookmarks
    //    （远端新书签/移动/删除在本机生效；事件守卫防回环）
    await reverseApplyIntoChrome(coordinator);

    // 4) 推本地 → 远端
    const pushed = await coordinator.flushPush();

    await api.storage.local.set({ [AFTER_ID_KEY]: coordinator.afterId });
    return { ok: true, pushed, pulled: pull.applied, seeded: seededRef.value };
  } catch (e) {
    return { ok: false, reason: "error", error: e?.message ?? String(e) };
  }
}

// ---- 事件桥接线（background.js 顶层调用）----
// MV3 要求 chrome.* 事件监听在 SW 顶层注册；coordinator 未就绪（未登录/无空间）
// 时事件安全跳过，下次 runSync 的播种兜底。
let bridgeRegistered = false;
let _coordinator = null; // 惰性单例（按 spaceId 缓存）
let _bridge = null;
let _eventGuard = { value: false }; // captureLocalEvents 返回的 suppressed 标志
const seededRef = { value: false };

export function registerLocalEventBridge() {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  const bridge = getOrCreateBridge();
  _eventGuard = captureLocalEvents(
    globalThis.chrome?.bookmarks,
    () => getCoordinatorCached(),
    bridge,
    flushSoon,
  );
}

/** 反向应用：把合并后的 CRDT 可见树写回 chrome.bookmarks（远端→本机）。 */
async function reverseApplyIntoChrome(coordinator) {
  const chrome = globalThis.chrome?.bookmarks;
  if (!chrome) return;
  const bridge = getOrCreateBridge();
  const guard = _eventGuard ?? { value: false };
  guard.value = true; // 抑制事件回环（create/move/update 会触发 onCreated 等）
  try {
    await reverseApply(chrome, coordinator, bridge);
    await api.storage.local.set({ [IDMAP_KEY]: bridge.snapshot() });
  } finally {
    guard.value = false;
  }
}

function getCoordinatorCached() {
  return _coordinator;
}

/** 获取（必要时创建）跨事件/同步共用的 coordinator 单例。 */
export async function getCoordinator(spaceId, deviceId, key) {
  if (_coordinator && _coordinator.spaceId === spaceId) return _coordinator;
  const afterIdRes = await api.storage.local.get(AFTER_ID_KEY);
  const afterId = Number(afterIdRes[AFTER_ID_KEY] ?? 0);
  const transport = new SupabaseOpLogTransport(supabase);
  _coordinator = new SyncCoordinator({ spaceId, deviceId, transport, key, afterId });
  return _coordinator;
}

/** chromeId↔uuid 映射桥：内存 + chrome.storage.local 持久化（重启不丢）。 */
function getOrCreateBridge() {
  if (_bridge) return _bridge;
  _bridge = new IdBridge(() => {
    // 持久化快照（防抖到微任务避免高频写）
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      api.storage.local.set({ [IDMAP_KEY]: _bridge.snapshot() }).catch(() => {});
    }, 300);
  });
  api.storage.local.get(IDMAP_KEY).then((r) => {
    if (r[IDMAP_KEY]) _bridge.load(r[IDMAP_KEY]);
  }).catch(() => {});
  api.storage.local.get(SEEDED_KEY).then((r) => { seededRef.value = !!r[SEEDED_KEY]; }).catch(() => {});
  return _bridge;
}
let persistTimer = null;

/**
 * 播种：把现有 chrome 书签树转成一批 MoveOp（仅首设备/云端空时调用）。
 * 幂等：已映射的 chromeId 跳过；未映射的生成 uuid 并 createNodeWithId。
 */
export async function seedExistingTree(coordinator) {
  if (seededRef.value) return { seeded: false };
  const bridge = getOrCreateBridge();
  if (!globalThis.chrome?.bookmarks) return { seeded: false, reason: "no-chrome-bookmarks" };
  const tree = await globalThis.chrome.bookmarks.getTree();
  let seeded = 0;
  const walk = async (node, parentUuid) => {
    const existing = bridge.toUuid(node.id);
    if (existing) {
      // 根节点直接续走子树
      for (const child of node.children ?? []) await walk(child, existing);
      return;
    }
    const uuid = globalThis.crypto.randomUUID();
    bridge.map(node.id, uuid);
    const meta = { title: node.title, ...(node.url ? { url: node.url } : {}) };
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
      const pushed = await c.flushPush();
      await api.storage.local.set({ [AFTER_ID_KEY]: c.afterId });
      if (pushed > 0) {
        await api.storage.local.set({ lastSyncAt: Date.now(), lastSyncStatus: `推送 ${pushed} 条` });
      }
    } catch { /* 下轮 runSync 兜底 */ }
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
