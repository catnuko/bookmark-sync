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
} from "./sync/index.js";
import { KeyManager } from "./sync/index.js";

const DEVICE_ID_KEY = "crdt.deviceId";
const AFTER_ID_KEY = "crdt.afterId";

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
// TODO(first-run-bootstrap): 首次在空本机跑起来时，需要把现有 chrome 书签树
// 「播种」成一批本地 MoveOp（createNodeWithId）。当前版本假设本机尚无数据，
// 真正的播种逻辑见 chromeBridge.ts，待真机验证后接入。
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

    const afterIdRes = await api.storage.local.get(AFTER_ID_KEY);
    const afterId = Number(afterIdRes[AFTER_ID_KEY] ?? 0);

    const transport = new SupabaseOpLogTransport(supabase);
    const coordinator = new SyncCoordinator({
      spaceId: active.id,
      deviceId,
      transport,
      key,
      afterId,
    });

    // 1) 拉远端 → 本地 CRDT
    const pull = await coordinator.pull();
    // 2) 推本地 → 远端
    const pushed = await coordinator.flushPush();

    await api.storage.local.set({ [AFTER_ID_KEY]: coordinator.afterId });

    return { ok: true, pushed, pulled: pull.applied };
  } catch (e) {
    return { ok: false, reason: "error", error: e?.message ?? String(e) };
  }
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
