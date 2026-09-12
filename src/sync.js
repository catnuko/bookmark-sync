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
import { ensureKey, decryptNodes, encryptNodes, isEncrypted, getEncryptMode } from "./crypto.js";

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
// 身份对齐优先级：本地映射 > 远端身份 > baseline 身份 > 新建
// 对齐 baseline 是为了处理离线场景：离线删除后重建相同内容时，能恢复原 sync_id，避免产生重复节点
async function toSyncNodes(localFlat, maps, remoteNodes, baselineNodes) {
  const identityToSync = new Map();
  // 先填充远端身份（远端是权威来源）
  for (const r of remoteNodes) {
    const ident = await nodeIdentity({ type: r.type, title: r.title, url: r.url, path: rootLabel(r) });
    if (!identityToSync.has(ident)) identityToSync.set(ident, r.sync_id);
  }
  // 再填充 baseline 身份（兜底：离线删除后重建的相同内容能找回原 sync_id）
  for (const b of baselineNodes ?? []) {
    const ident = await nodeIdentity({ type: b.type, title: b.title, url: b.url, path: rootLabel(b) });
    if (!identityToSync.has(ident)) identityToSync.set(ident, b.sync_id);
  }

  // nativeId → sync_id（优先用映射；其次按身份对齐；最后新建）
  const nativeToSync = new Map();
  for (const ln of localFlat) {
    let sid = maps.byNative[ln.nativeId];
    if (!sid) {
      const ident = await nodeIdentity(ln);
      sid = identityToSync.get(ident);
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

  // 拓扑排序：根级（parent 为 ROOT_*）在前，子文件夹随父，书签最后
  // 这样创建时父文件夹已存在，避免子节点找不到父
  const depth = (n) => {
    if (n.parent_sync_id === ROOT_BAR || n.parent_sync_id === ROOT_OTHER) return 0;
    const parent = nodes.find((x) => x.sync_id === n.parent_sync_id);
    return parent ? 1 + depth(parent) : 0;
  };
  const sortedNodes = [...nodes].sort((a, b) => {
    const da = depth(a), db = depth(b);
    if (da !== db) return da - db;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  // 1) 删除本地多余节点（目标里没有的）
  for (const ln of localFlat) {
    const sid = maps.byNative[ln.nativeId];
    const keep = sid
      ? targetSyncIds.has(sid)
      : sortedNodes.some((n) => n.type === ln.type && n.url === ln.url && n.title === ln.title && (n.parent_sync_id ?? "") === rootOf(ln));
    if (!keep) {
      await api.bookmarks.remove(ln.nativeId).catch(() => {});
      changes++;
    }
  }

  // 2) 建 / 更新（文件夹和书签都处理，拓扑顺序保证父先建）
  for (const n of sortedNodes) {
    if (!n.sync_id) continue;

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
      // 创建：文件夹不带 url，书签带 url
      const created = await api.bookmarks.create({
        parentId: parentNative,
        index: n.order ?? 0,
        title: n.title ?? "",
        ...(n.type === "bookmark" ? { url: n.url } : {}),
      });
      maps.byNative[created.id] = n.sync_id;
      maps.bySync[n.sync_id] = created.id;
      if (n.type === "folder") folderBySync.set(n.sync_id, created.id);
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
  // 收集本地当前所有已映射的 sync_id（有映射才参与删除判定，无映射的新建节点不产生墓碑）
  const localSyncIds = new Set();
  for (const ln of localFlat) {
    const sid = maps.byNative[ln.nativeId];
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

  // 加密模式（可选项）：账号级，默认 E2EE。
  // 形态自动跟随 —— 以服务端已有数据形态为准，仅当首推（无远端数据）时用本地开关决定，
  // 保证同一账号多设备不会"一台加密一台明文"互相污染。
  //   - 远端是密文 → 解密路径（需密钥，缺则提示 decrypt_error）
  //   - 远端是明文 → 明文路径（不做加解密，等于关闭 E2EE）
  //   - 远端为空   → 按本地开关初始化首份数据

  // 1. 拉取远端
  const { data: pullData, error: pullError } = await supabase.rpc("bsync_snapshot_pull");
  if (pullError) return { ok: false, reason: "rpc_error", error: pullError.message };
  const rawRemote = pullData?.bookmarks ?? [];
  const remoteTombstones = pullData?.tombstones ?? [];

  const remoteIsCipher = rawRemote.some((n) => isEncrypted(n?.title) || isEncrypted(n?.url));
  const localMode = await getEncryptMode();
  const e2ee = remoteIsCipher || (rawRemote.length === 0 && localMode === "e2ee");

  // 2. 本地 → sync 表示
  const localFlat = await readLocalTree();
  const maps = await loadMaps();
  const baseline = await loadBaseline();

  let keyBytes = null;
  let remoteNodes;
  if (e2ee) {
    keyBytes = await ensureKey();
    remoteNodes = await decryptNodes(rawRemote, keyBytes);
    if (remoteNodes == null) {
      return { ok: false, reason: "decrypt_error", error: "服务端数据无法解密，请检查是否已导入正确的同步密钥或口令" };
    }
  } else {
    remoteNodes = rawRemote;
  }

  // baseline（本地图）始终存明文域：解密失败仅发生在 e2ee 往返，明文域本身无需密钥
  const baselineNodes = e2ee ? await decryptNodes(baseline.nodes, keyBytes) : baseline.nodes;
  if (e2ee && baselineNodes == null) {
    return { ok: false, reason: "decrypt_error", error: "本地基线数据无法解密，请检查同步密钥或口令" };
  }
  const localNodes = await toSyncNodes(localFlat, maps, remoteNodes, baselineNodes);

  // 3. 三态合并（全部在明文域）
  const merged = mergeStates(baselineNodes, localNodes, remoteNodes);

  // 4. 应用到本地
  const pulled = await applyNodes(merged, maps);

  // 5. 计算并推送墓碑 + 合并结果（e2ee 时 title/url 加密上传，明文模式原样上传）
  const tombstones = await computeLocalTombstones(baselineNodes, remoteNodes, remoteTombstones);
  const pushPayload = e2ee ? await encryptNodes(merged, keyBytes) : merged;
  const { data: pushResult, error: pushError } = await supabase.rpc("bsync_snapshot_push", {
    p_data: pushPayload,
    p_tombstones: tombstones,
    p_device: await getDeviceId(),
  });
  if (pushError) {
    const msg = pushError.message || "";
    if (msg.includes("quota_exceeded")) return { ok: false, reason: "quota_exceeded" };
    return { ok: false, reason: "rpc_error", error: msg };
  }

  // 6. 成功后重新拉取服务端实际快照作为 baseline
  //    （服务端会过滤墓碑，merged ≠ 服务端实际存储；用实际快照才能正确区分下次的"删除"与"未推送"）
  const { data: afterPull } = await supabase.rpc("bsync_snapshot_pull");
  await saveLocalTombstones([]);
  const afterRaw = afterPull?.bookmarks ?? [];
  const afterNodes = e2ee ? await decryptNodes(afterRaw, keyBytes) : afterRaw;
  await saveBaseline(afterNodes ?? []); // baseline 存明文域

  return {
    ok: true,
    pushed: merged.length,
    pulled,
    tombstones: tombstones.length,
    encrypted: e2ee,
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

  // E2EE 可选项：跟随数据形态。历史快照若是密文则解密，明文则原样。
  const restoredRaw = snapshotData ?? [];
  const snapIsCipher = restoredRaw.some((n) => isEncrypted(n?.title) || isEncrypted(n?.url));
  let keyBytes = null;
  let restoredNodes;
  if (snapIsCipher) {
    keyBytes = await ensureKey();
    restoredNodes = await decryptNodes(restoredRaw, keyBytes);
    if (restoredNodes == null) {
      return { ok: false, reason: "decrypt_error", error: "历史快照无法解密，请检查是否已导入正确的同步密钥或口令" };
    }
  } else {
    restoredNodes = restoredRaw;
  }

  const maps = await loadMaps();
  const changes = await applyNodes(restoredNodes, maps, { restore: true });

  const localFlat = await readLocalTree();
  const baseline = await loadBaseline();
  const baselineNodes = snapIsCipher ? await decryptNodes(baseline.nodes, keyBytes) : baseline.nodes;
  const nodes = await toSyncNodes(localFlat, maps, restoredNodes ?? [], baselineNodes ?? []);
  const pushPayload = snapIsCipher ? await encryptNodes(nodes, keyBytes) : nodes;
  const { error: pushError } = await supabase.rpc("bsync_snapshot_push", {
    p_data: pushPayload,
    p_tombstones: [],
    p_device: await getDeviceId(),
  });
  if (!pushError) await saveBaseline(nodes); // baseline 存明文域

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