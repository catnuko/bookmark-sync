// 书签同步引擎 —— JSON 快照方案（含配额校验 + plan 门控）
// 每次同步：拉取最新快照 → diff 并应用到本地 → 通过 RPC 推送合并后的新快照
// 历史快照保留在服务端，可随时恢复到任意版本（Pro / Lifetime 可用）

import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";

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

// 将服务端快照应用到本地：按 URL 匹配，增删改
async function applySnapshot(serverBookmarks) {
  const localTree = await readLocalTree();
  const localByUrl = new Map();
  for (const b of localTree) {
    if (!localByUrl.has(b.url)) localByUrl.set(b.url, b);
  }

  const serverUrls = new Set(serverBookmarks.map((b) => b.url));
  let changes = 0;

  // 1. 删除本地有但服务端没有的书签
  for (const b of localTree) {
    if (!serverUrls.has(b.url)) {
      await api.bookmarks.remove(b.id).catch(() => {});
      changes++;
    }
  }

  // 2. 创建或更新服务端书签
  for (const sb of serverBookmarks) {
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
 * 走 RPC bsync_snapshot_push，含配额检查
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

  // 1. 拉取最新快照
  const { data: latest } = await supabase
    .from("bsync_snapshots")
    .select("id, data, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let pulled = 0;
  if (latest?.data) {
    pulled = await applySnapshot(latest.data);
  }

  // 2. 通过 RPC 推送合并后的本地树（含配额检查）
  const localTree = await readLocalTree();
  const bookmarks = localTree.map(({ url, title, folder }) => ({ url, title, folder }));

  const { data: pushResult, error } = await supabase.rpc("bsync_snapshot_push", {
    p_data: bookmarks,
  });

  if (error) {
    // Supabase 把 RAISE EXCEPTION 转成 error.message
    const msg = error.message || "";
    if (msg.includes("quota_exceeded")) {
      return { ok: false, reason: "quota_exceeded" };
    }
    // 其他错误归为 rpc_error，附带原始信息便于排查
    return { ok: false, reason: "rpc_error", error: msg };
  }

  return {
    ok: true,
    pushed: bookmarks.length,
    pulled,
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

  // 应用快照到本地
  const changes = await applySnapshot(snapshotData);

  // 恢复后通过 RPC 推送一份新快照（同样走配额检查，恢复的快照不会超限）
  const localTree = await readLocalTree();
  const bookmarks = localTree.map(({ url, title, folder }) => ({ url, title, folder }));
  await supabase.rpc("bsync_snapshot_push", { p_data: bookmarks });

  // 取快照创建时间用于 UI 提示
  const { data: meta } = await supabase
    .from("bsync_snapshots")
    .select("created_at")
    .eq("id", id)
    .single();

  return { ok: true, changes, createdAt: meta?.created_at };
}
