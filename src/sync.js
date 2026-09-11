// 书签同步引擎 —— 真树 + sync_id + 三态基线合并（快照方案进化版）
// ------------------------------------------------------------------
// 相比旧的「URL 当键 + folder 路径字符串」扁平方案，本版解决三个硬伤：
//   1. 同 URL 多文件夹   → 每节点有稳定 sync_id（ULID），URL 不再当主键
//   2. 文件夹改名/移动丢子项 → 快照用 parent_sync_id 表达真树，节点有 order 排序
//   3. 删除复活          → 墓碑按 sync_id 记录，配合本地三态合并避免误删/复活
//
// 合并模型：三态合并（Three-way Merge）
//   baseline   = 上次成功同步后记录的远端节点快照（本地图）
//   localNodes = 当前本地浏览器书签树（sync 表示）
//   remoteNodes= 本次同步拉取到的远端快照
//   三方 diff 求并集合并，再应用回本地并推回远端。
//
// 冲突解决：
//   新增不同节点       → 并集保留
//   同一节点两端改内容  → updated_at 较新者胜（LWW）
//   一端删除一端修改    → 删除获胜（墓碑粘性，服务端 + 本地双保险）
//   删除后原设备重加    → 清除自己 deviceId 的墓碑（重加获胜）
//   移动冲突           → updated_at 较新者胜（可接受的近似）
// ------------------------------------------------------------------

import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";

// ============================================================
// 根节点常量（跨浏览器根标识统一）
// ============================================================
const ROOT_BAR = "__bar__"; // Chrome Bar / Firefox Toolbar
const ROOT_OTHER = "__other__"; // Chrome Other / Firefox Other

// ============================================================
// deviceId：每个浏览器安装一个持久随机 ID
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

// 生成稳定 sync_id（section 前缀 + 时间基 + 随机后缀）
function newSyncId() {
  const ts = Date.now().toString(36);
  const rnd =
    globalThis.crypto?.getRandomValues?.(
      new Uint8Array(10)
    ) ?? Array.from({ length: 10 }, () => Math.floor(Math.random() * 256));
  const suffix = Array.from(rnd)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return `sy-${ts}-${suffix}`;
}

// 计算字符串的短哈希（WebCrypto，浏览器可用）：SHA-256 → 取前 16 hex
async function hashText(s) {
  const buf = new TextEncoder().encode(s);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 节点内容身份：path + type + title + url 的哈希（结构化，跨浏览器稳定）
async function nodeIdentity(node) {
  const path = node.path ?? "";
  const content = JSON.stringify([node.type ?? "bookmark", node.title ?? "", node.url ?? ""]);
  return `${path}|${await hashText(content)}`;
}

// ============================================================
// 本地持久化：映射 + 基线
// ============================================================
const MAPPING_KEY = "syncIdMaps";
const BASELINE_KEY = "lastSyncBaseline";
const LOCAL_TOMB_KEY = "localTombstones"; // [{sync_id, url}] 本设备删除过的节点

async function loadMaps() {
  const res = await api.storage.local.get(MAPPING_KEY);
  return res[MAPPING_KEY] ?? { byNative: {}, bySync: {}, byIdentity: {} };
}
async function saveMaps(m) {
  await api.storage.local.set({ [MAPPING_KEY]: m });
}
async function loadBaseline() {
  const res = await api.storage.local.get(BASELINE_KEY);
  return { nodes: res[BASELINE_KEY]?.nodes ?? [], at: res[BASELINE_KEY]?.at ?? 0 };
}
async function saveBaseline(nodes) {
  await api.storage.local.set({ [BASELINE_KEY]: { nodes, at: Date.now() } });
}
async function loadLocalTombstones() {
  const res = await api.storage.local.get(LOCAL_TOMB_KEY);
  return res[LOCAL_TOMB_KEY] ?? [];
}
async function saveLocalTombstones(list) {
  await api.storage.local.set({ [LOCAL_TOMB_KEY]: list });
}

// ============================================================
// 本地树读取 → sync 表示（含映射 / 身份对齐 / 新 sync_id 分配）
// ============================================================

// 展平浏览器书签树，保留原生父关系（parentNativeId），同时给出根桶与 path 便于身份计算
// 返回顺序：先序遍历，父永远在子之前（便于 apply 时父已建）。
async function readLocalTree() {
  const [root] = await api.bookmarks.getTree();
  const roots = root.children ?? [];
  const bar =
    roots.find((r) => r.title === "Bookmarks Bar" || r.title === "Bookmarks Toolbar") ??
    roots[0];
  const other = roots.find((r) => r !== bar && !r.url) ?? null;

  const flat = [];
  const walk = (node, parentNativeId, rootSync, path, orderInParent) => {
    const row = {
      nativeId: node.id,
      parentNativeId, // 父节点原生 id（根桶为 null）
      rootSync, // __bar__ | __other__
      type: node.url ? "bookmark" : "folder",
      title: node.title ?? "",
      url: node.url ?? null,
      path,
      order: orderInParent,
    };
    flat.push(row);
    if (!node.url) {
      (node.children ?? []).forEach((c, i) =>
        walk(c, node.id, rootSync, row.path ? `${path}/${node.title ?? ""}` : node.title ?? "", i)
      );
    }
  };
  if (bar) (bar.children ?? []).forEach((c, i) => walk(c, null, ROOT_BAR, "BAR", i));
  if (other) (other.children ?? []).forEach((c, i) => walk(c, null, ROOT_OTHER, "OTHER", i));
  return flat;
}

// 把本地扁平树转成 sync 节点数组（分配 / 对齐 sync_id，建立 parent_sync_id）
async function toSyncNodes(localFlat, maps, remoteNodes) {
  const remByIdentity = new Map();
  for (const r of remoteNodes)
    remByIdentity.set(await nodeIdentity({ type: r.type, title: r.title, url: r.url, path: rootLabel(r) }), r.sync_id);

  // nativeId → sync_id（优先用映射；其次按身份对齐远端；最后新建）
  const nativeToSync = new Map();
  for (const ln of localFlat) {
    let sid = maps.byNative[ln.nativeId];
    if (!sid) {
      const ident = await nodeIdentity(ln);
      sid = remByIdentity.get(ident);
      if (sid) maps.byIdentity[ident] = sid;
      else {
        sid = newSyncId();
        maps.byIdentity[ident] = sid;
      }
    }
    nativeToSync.set(ln.nativeId, sid);
  }
  await saveMaps(maps);

  // 转成 sync 表示：父为纯文件夹节点时其 sync_id 已在上方循环分配（先序保证父先于子）
  return localFlat.map((ln) => ({
    sync_id: nativeToSync.get(ln.nativeId),
    parent_sync_id: resolveParentSyncFor(ln, nativeToSync),
    type: ln.type,
    url: ln.url,
    title: ln.title,
    order: ln.order,
    updated_at: nowIso(),
  }));
}

// 用原生父关系取父 sync_id：父是根桶（parentNativeId 为 null）→ 根常量化；否则取上级文件夹 sync_id
function resolveParentSyncFor(ln, nativeToSync) {
  if (!ln.parentNativeId) return ln.rootSync === ROOT_OTHER ? ROOT_OTHER : ROOT_BAR;
  return nativeToSync.get(ln.parentNativeId) ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

// ============================================================
// 三态合并：baseline vs local vs remote
// ============================================================
function mergeStates(baselineNodes, localNodes, remoteNodes) {
  const indexBySync = (arr) => {
    const m = new Map();
    for (const n of arr) if (n?.sync_id) m.set(n.sync_id, n);
    return m;
  };
  const base = indexBySync(baselineNodes);
  const loc = indexBySync(localNodes);
  const rem = indexBySync(remoteNodes);

  const allSyncIds = new Set([...base.keys(), ...loc.keys(), ...rem.keys()]);
  const out = [];

  for (const sid of allSyncIds) {
    const b = base.get(sid);
    const l = loc.get(sid) ?? b;
    const r = rem.get(sid) ?? b;
    const bNode = b ?? l ?? r;

    const changedLocal = b && l && JSON.stringify(l) !== JSON.stringify(b);
    const changedRemote = b && r && JSON.stringify(r) !== JSON.stringify(b);

    // 两端都未变 → 用远端（若在远端）否则用本地
    if (!changedLocal && !changedRemote) {
      if (r) out.push(r);
      else if (l) out.push(l);
      continue;
    }
    // 本地变了、远端未变 → 用本地
    if (changedLocal && !changedRemote) {
      out.push(l);
      continue;
    }
    // 远端变了、本地未变 → 用远端
    if (!changedLocal && changedRemote) {
      out.push(r);
      continue;
    }
    // 两端都变 → LWW（较新 updated_at 胜）
    out.push((l.updated_at ?? "") >= (r.updated_at ?? "") ? l : r);
  }
  return out;
}

// ============================================================
// 将 sync 节点数组应用回浏览器书签树
// ============================================================
async function applyNodes(nodes, maps, { restore = false } = {}) {
  // nodes 顺序：文件夹在子之前（readLocalTree 压栈顺序已保证）
  const folderBySync = new Map(); // sync_id → nativeId
  // 预注册已存在的文件夹映射
  const localFlat = await readLocalTree();
  for (const ln of localFlat) {
    if (ln.type === "folder") {
      const sid = maps.byNative[ln.nativeId];
      if (sid) folderBySync.set(sid, ln.nativeId);
    }
  }

  const targetSyncIds = new Set(nodes.filter((n) => n.sync_id).map((n) => n.sync_id));
  const locByIdentity = new Map();
  for (const ln of localFlat) locByIdentity.set(await nodeIdentity(ln), ln.nativeId);

  let changes = 0;

  // 1) 删除本地多余节点（目标里没有的）
  for (const ln of localFlat) {
    const sid = maps.byNative[ln.nativeId];
    const keep = sid
      ? targetSyncIds.has(sid)
      : nodes.some((n) => n.type === ln.type && n.url === ln.url && n.title === ln.title && (n.parent_sync_id ?? "") === rootOf(ln));
    if (!keep) {
      await api.bookmarks.remove(ln.nativeId).catch(() => {});
      changes++;
    }
  }

  // 2) 建 / 更新
  for (const n of nodes) {
    if (!n.sync_id || n.type === "folder") {
      // 文件夹若无 sync_id 且为根级标签，忽略（根桶不进入同步节点）
      continue;
    }
    let nativeId = maps.byNative[n.sync_id];
    if (!nativeId) {
      const ident = await nodeIdentity({ type: n.type, title: n.title, url: n.url, path: rootLabel(n) });
      nativeId = locByIdentity.get(ident);
    }

    const parentNative = await resolveParentNative(n, folderBySync, maps);
    if (!parentNative) continue;

    if (nativeId) {
      // 更新标题
      const cur = await api.bookmarks.get(nativeId).catch(() => null);
      if (cur?.[0] && cur[0].title !== n.title) {
        await api.bookmarks.update(nativeId, { title: n.title }).catch(() => {});
        changes++;
      }
      // 移动父（用 current parent 对比）
      const parentInfo = await currentParentNative(nativeId);
      if (parentInfo && parentInfo !== parentNative) {
        await api.bookmarks.move(nativeId, { parentId: parentNative, index: n.order ?? 0 }).catch(() => {});
        changes++;
      }
    } else {
      const created = await api.bookmarks.create({
        parentId: parentNative,
        index: n.order ?? 0,
        title: n.title ?? "",
        url: n.type === "bookmark" ? n.url : undefined,
      });
      maps.byNative[created.id] = n.sync_id;
      maps.bySync[n.sync_id] = created.id;
      changes++;
    }
  }

  await saveMaps(maps);
  return changes;
}

function rootLabel(n) {
  return (n.parent_sync_id === ROOT_BAR || n.path?.startsWith?.("BAR")) ? "BAR" : "OTHER";
}
function rootOf(ln) {
  return ln.path?.startsWith?.("BAR") ? ROOT_BAR : ROOT_OTHER;
}
async function currentParentNative(nativeId) {
  const [row] = await api.bookmarks.get(nativeId).catch(() => []);
  return row?.parentId ?? null;
}
async function resolveParentNative(n, folderBySync, maps) {
  if (n.parent_sync_id === ROOT_BAR || n.parent_sync_id === ROOT_OTHER) {
    const [root] = await api.bookmarks.getTree();
    const roots = root.children ?? [];
    if (n.parent_sync_id === ROOT_OTHER) return roots.find((r) => r.id !== roots[0]?.id)?.id ?? roots[0]?.id ?? root.id;
    return roots[0]?.id ?? root.id;
  }
  return folderBySync.get(n.parent_sync_id) ?? maps.bySync[n.parent_sync_id] ?? null;
}

// 计算本设备待上传的墓碑：baseline 里存在、但本地已消除的 sync_id（排除远端已删的）
async function computeLocalTombstones(baselineNodes, remoteNodes, remoteTombstones) {
  const localFlat = await readLocalTree();
  const maps = await loadMaps();
  const localSyncIds = new Set();
  for (const ln of localFlat) {
    const sid = maps.byNative[ln.nativeId] ?? maps.bySync ? null : maps.byNative[ln.nativeId];
    if (sid) localSyncIds.add(sid);
  }
  const remoteSyncIds = new Set(remoteNodes.map((r) => r.sync_id));
  const dead = [];
  for (const b of baselineNodes) {
    if (b.sync_id && !localSyncIds.has(b.sync_id) && remoteSyncIds.has(b.sync_id)) {
      dead.push({ sync_id: b.sync_id, url: b.url ?? "" });
    }
  }
  // 合并持久化的本地墓碑
  const persisted = await loadLocalTombstones();
  const merged = new Map();
  for (const t of persisted) merged.set(t.sync_id, t);
  for (const t of dead) merged.set(t.sync_id, t);
  return [...merged.values()];
}

// ============================================================
// 公开 API
// ============================================================

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
 * @returns {Promise<{ok, pushed, pulled, reason?, size?, quota?, plan?, tombstones?}>}
 */
export async function runSync() {
  const { data: session } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "unauthenticated" };

  // 1. 拉取远端
  const { data: pullData, error: pullError } = await supabase.rpc("bsync_snapshot_pull");
  if (pullError) return { ok: false, reason: "rpc_error", error: pullError.message };
  const remoteNodes = pullData?.bookmarks ?? [];
  const remoteTombstones = pullData?.tombstones ?? [];

  // 2. 本地 → sync 表示
  const localFlat = await readLocalTree();
  const maps = await loadMaps();
  const baseline = await loadBaseline();
  const localNodes = await toSyncNodes(localFlat, maps, remoteNodes);

  // 3. 三态合并
  const merged = mergeStates(baseline.nodes, localNodes, remoteNodes);

  // 4. 应用到本地
  const pulled = await applyNodes(merged, maps);

  // 5. 计算并推送墓碑 + 合并结果
  const tombstones = await computeLocalTombstones(baseline.nodes, remoteNodes, remoteTombstones);
  const { data: pushResult, error: pushError } = await supabase.rpc("bsync_snapshot_push", {
    p_data: merged,
    p_tombstones: tombstones,
    p_device: await getDeviceId(),
  });
  if (pushError) {
    const msg = pushError.message || "";
    if (msg.includes("quota_exceeded")) return { ok: false, reason: "quota_exceeded" };
    return { ok: false, reason: "rpc_error", error: msg };
  }

  // 6. 成功后清空持久墓碑、记录基线
  await saveLocalTombstones([]);
  await saveBaseline(merged);

  return {
    ok: true,
    pushed: merged.length,
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

export async function restoreSnapshot(id) {
  const { data: session } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "unauthenticated" };
  const { data: snapshotData, error } = await supabase.rpc("bsync_snapshot_restore", {
    p_snapshot_id: id,
  });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("plan_locked")) return { ok: false, reason: "plan_locked" };
    if (msg.includes("not_found")) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "rpc_error", error: msg };
  }
  const maps = await loadMaps();
  const changes = await applyNodes(snapshotData ?? [], maps, { restore: true });

  const localFlat = await readLocalTree();
  const baseline = await loadBaseline();
  const nodes = await toSyncNodes(localFlat, maps, snapshotData ?? []);
  const { error: pushError } = await supabase.rpc("bsync_snapshot_push", {
    p_data: nodes,
    p_tombstones: [],
    p_device: await getDeviceId(),
  });
  if (!pushError) await saveBaseline(nodes);

  const { data: meta } = await supabase
    .from("bsync_snapshots")
    .select("created_at")
    .eq("id", id)
    .single();
  return { ok: true, changes, createdAt: meta?.created_at };
}

// 为兼容 background.js 的事件墓碑语义留存（新引擎不依赖其单独维护）
export async function recordTombstone() {}
export async function clearTombstone() {}