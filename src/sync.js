// 书签同步引擎 —— 并集合并 + 墓碑（快照方案）
// 并发变更合并规则：
//   新增：并集 —— 任一设备本地有而服务端没有的书签都会被保留（推送时上传）
//   删除：墓碑 —— 某设备删除某 URL 后，其余设备同步时同样删除它，且不会被复活
//   重加：原删除设备重新添加同一 URL → 清除自己拥有的墓碑（重加获胜）
// 流程：拉取(快照+墓碑) → 应用(并集合并+墓碑清理本地) → 推送(本地树+本地墓碑+deviceId)

import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";

// ============================================================
// deviceId：每个浏览器安装一个持久随机 ID，用于标记墓碑来源
// ============================================================
let cachedDeviceId = null;

export async function getDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  const { deviceId } = await api.storage.local.get("deviceId");
  if (deviceId) {
    cachedDeviceId = deviceId;
    return deviceId;
  }
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await api.storage.local.set({ deviceId: id });
  cachedDeviceId = id;
  return id;
}

// ============================================================
// 本地墓碑：记录本设备删除过的 URL（推送时上传；重加时清除）
// ============================================================
const TOMBSTONE_KEY = "localTombstones";

async function readLocalTombstones() {
  const { [TOMBSTONE_KEY]: list } = await api.storage.local.get(TOMBSTONE_KEY);
  return Array.isArray(list) ? list : [];
}

async function writeLocalTombstones(urls) {
  await api.storage.local.set({ [TOMBSTONE_KEY]: urls });
}

/** 本地删除某书签 → 记录墓碑（后台 onRemoved 调用） */
export async function recordTombstone(url) {
  if (!url) return;
  const list = await readLocalTombstones();
  if (list.includes(url)) return;
  await writeLocalTombstones([...list, url]);
}

/** 本地重新添加某书签 → 清除墓碑（后台 onCreated 调用，重加获胜） */
export async function clearTombstone(url) {
  if (!url) return;
  const list = await readLocalTombstones();
  if (!list.includes(url)) return;
  await writeLocalTombstones(list.filter((u) => u !== url));
}

// 读取整棵书签树，展平为 [{id, url, title, folder}]
async function readLocalTree() {
  const [root] = await api.bookmarks.getTree();
  const flat = [];
  const walk = (node, prefix) => {
    for (const child of node.children ?? []) {
      if (child.url) {
        flat.push({ id: child.id, url: child.url, title: child.title ?? "", folder: prefix });
      } else {
        walk(child, prefix ? `${prefix}/${child.title ?? ""}` : (child.title ?? ""));
      }
    }
  };
  const roots = root.children ?? [];
  roots.forEach((r, i) => walk(r, i === 0 ? "BAR" : "OTHER"));
  return flat;
}

// 确保本地存在对应文件夹路径（如 "BAR/技术/前端"），返回文件夹 id
async function ensureFolder(path) {
  const [root] = await api.bookmarks.getTree();
  const roots = root.children ?? [];
  if (!roots.length) return root.id;
  const parts = String(path).split("/").filter(Boolean);
  const rootIdx = parts[0] === "BAR" ? 0 : 1;
  let parentId = roots[Math.min(rootIdx, roots.length - 1)].id;
  for (const seg of parts.slice(1)) {
    const children = await api.bookmarks.getChildren(parentId);
    const found = children.find((c) => !c.url && c.title === seg);
    parentId = found ? found.id : (await api.bookmarks.create({ parentId, title: seg })).id;
  }
  return parentId;
}

// 将服务端状态应用到本地
//   merge（默认）：并集合并 —— 本地独有的书签不删除（删除只靠墓碑传播）
//   restore：完整替换 —— 对齐到历史快照，忽略墓碑（恢复历史版本用）
async function applySnapshot(serverBookmarks, serverTombstones = [], { restore = false } = {}) {
  const localTree = await readLocalTree();
  const localTombstones = restore ? [] : await readLocalTombstones();
  const tombstoneSet = new Set([...serverTombstones, ...localTombstones]);

  const localByUrl = new Map();
  for (const b of localTree) {
    if (!localByUrl.has(b.url)) localByUrl.set(b.url, b);
  }

  const serverUrls = new Set(serverBookmarks.map((b) => b.url));
  let changes = 0;

  // 1. 删除本地书签
  //    merge：本地存在且被任何设备删除过（墓碑）→ 删除传播
  //    restore：本地有但快照里没有 → 对齐到历史快照
  for (const b of localTree) {
    const shouldRemove = restore ? !serverUrls.has(b.url) : tombstoneSet.has(b.url);
    if (shouldRemove) {
      await api.bookmarks.remove(b.id).catch(() => {});
      changes++;
    }
  }

  // 2. 创建 / 更新服务端书签
  for (const sb of serverBookmarks) {
    if (!restore && tombstoneSet.has(sb.url)) continue; // 被删除过 → 跳过，不复活
    const local = localByUrl.get(sb.url);
    if (local) {
      if (local.title !== sb.title) {
        await api.bookmarks.update(local.id, { title: sb.title });
        changes++;
      }
      if (local.folder !== sb.folder) {
        await api.bookmarks.move(local.id, { parentId: await ensureFolder(sb.folder) });
        changes++;
      }
    } else {
      await api.bookmarks.create({
        parentId: await ensureFolder(sb.folder),
        title: sb.title,
        url: sb.url,
      });
      changes++;
    }
  }

  return changes;
}

/**
 * 获取当前用户档案（plan / used / quota）
 * @returns {Promise<{plan, quota_bytes, used_bytes, purchased_at} | null>}
 */
export async function getProfile() {
  const { data, error } = await supabase.rpc("bsync_get_profile");
  if (error) {
    console.warn("[sync] getProfile failed:", error.message);
    return null;
  }
  return data;
}

/**
 * 执行同步
 * 拉取 → 并集合并应用 → 通过 RPC 推送（含配额检查 + 墓碑合并）
 * @returns {Promise<{ok, pushed, pulled, reason?}>}
 *   reason 可能值：
 *     - "unauthenticated" 未登录
 *     - "quota_exceeded" 空间不足（免费用户超出 5MB）
 *     - "rpc_error" 其他 RPC 错误
 */
export async function runSync() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "unauthenticated" };

  // 1. 拉取最新快照 + 墓碑列表
  const { data: pullData, error: pullError } = await supabase.rpc("bsync_snapshot_pull");
  if (pullError) {
    return { ok: false, reason: "rpc_error", error: pullError.message };
  }
  const serverBookmarks = pullData?.bookmarks ?? [];
  const serverTombstones = pullData?.tombstones ?? [];

  // 2. 应用：并集合并（新增保留）+ 墓碑清理本地（删除传播）
  const pulled = await applySnapshot(serverBookmarks, serverTombstones);

  // 3. 读取本地树 + 本地墓碑，推送合并结果
  const localTree = await readLocalTree();
  const bookmarks = localTree.map(({ url, title, folder }) => ({ url, title, folder }));
  const tombstones = await readLocalTombstones();

  const { data: pushResult, error: pushError } = await supabase.rpc("bsync_snapshot_push", {
    p_data: bookmarks,
    p_tombstones: tombstones,
    p_device: await getDeviceId(),
  });

  if (pushError) {
    // Supabase 把 RAISE EXCEPTION 转成 error.message
    const msg = pushError.message || "";
    if (msg.includes("quota_exceeded")) {
      return { ok: false, reason: "quota_exceeded" };
    }
    // 其他错误归为 rpc_error，附带原始信息便于排查
    return { ok: false, reason: "rpc_error", error: msg };
  }

  // 推送成功 → 本地墓碑已并入服务端，清空本地（服务端墓碑继续提供保护）
  await writeLocalTombstones([]);

  return {
    ok: true,
    pushed: bookmarks.length,
    pulled,
    tombstones: tombstones.length,
    size: pushResult?.size,
    quota: pushResult?.quota,
    plan: pushResult?.plan,
  };
}

export async function listSnapshots(limit = 20) {
  const { data, error } = await supabase
    .from("bsync_snapshots")
    .select("id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`获取历史失败: ${error.message}`);
  return data ?? [];
}

/**
 * 恢复历史快照
 * 走 RPC bsync_snapshot_restore，免费用户抛 plan_locked
 * @returns {Promise<{ok, changes, createdAt?, reason?}>}
 *   reason 可能值：
 *     - "unauthenticated" 未登录
 *     - "plan_locked" 免费用户，需要升级 Pro
 *     - "not_found" 快照不存在
 *     - "rpc_error" 其他错误
 */
export async function restoreSnapshot(id) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "unauthenticated" };

  // 通过 RPC 拉取快照（含 plan 门控）
  const { data: snapshotData, error } = await supabase.rpc("bsync_snapshot_restore", {
    p_snapshot_id: id,
  });

  if (error) {
    const msg = error.message || "";
    if (msg.includes("plan_locked")) {
      return { ok: false, reason: "plan_locked" };
    }
    if (msg.includes("not_found")) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "rpc_error", error: msg };
  }

  // 恢复快照到本地（完整替换，忽略墓碑）
  const changes = await applySnapshot(snapshotData, [], { restore: true });

  // 恢复后通过 RPC 推送一份新快照（同样走配额检查，恢复的快照不会超限）
  const localTree = await readLocalTree();
  const bookmarks = localTree.map(({ url, title, folder }) => ({ url, title, folder }));
  const tombstones = await readLocalTombstones();
  const { error: pushError } = await supabase.rpc("bsync_snapshot_push", {
    p_data: bookmarks,
    p_tombstones: tombstones,
    p_device: await getDeviceId(),
  });
  if (!pushError) {
    await writeLocalTombstones([]);
  }

  // 取快照创建时间用于 UI 提示
  const { data: meta } = await supabase
    .from("bsync_snapshots")
    .select("created_at")
    .eq("id", id)
    .single();

  return { ok: true, changes, createdAt: meta?.created_at };
}
