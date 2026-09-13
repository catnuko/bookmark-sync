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
import { ensureKey, hasKey, decryptNodes, encryptNodes, isEncrypted, getEncryptMode } from "./crypto.js";

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

// ============================================================
// 同步空间：同一账号多棵独立书签树（工作/个人…）
// - activeSpaceId 为空 → 服务端默认空间（老用户行为完全不变）
// - maps / baseline / 本地墓碑按空间命名存储；默认空间回退读老键
// ============================================================
const SPACE_KEY = "activeSpaceId";

// 本次同步操作生效的空间上下文（runSync 内设置，
// 供 maps/baseline/墓碑的命名空间读写使用）
let spaceCtx = null; // { id, legacyFallback }

function spaceScopedKey(base) {
  return spaceCtx?.id ? `${base}:${spaceCtx.id}` : base;
}

export async function listSpaces() {
  const { data, error } = await supabase
    .from("bsync_spaces")
    .select("id, name, is_default, created_at")
    .order("is_default", { ascending: false })
    .order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

// UI 用：空间列表 + 当前生效空间（显式选择 > 默认空间 > 第一个）
export async function getActiveSpace() {
  const spaces = await listSpaces();
  const { activeSpaceId } = await api.storage.local.get(SPACE_KEY);
  const active =
    spaces.find((s) => s.id === activeSpaceId) ??
    spaces.find((s) => s.is_default) ??
    spaces[0] ??
    null;
  return { spaces, active, explicitId: activeSpaceId ?? null };
}

export async function switchSpace(id) {
  const spaces = await listSpaces();
  if (!spaces.some((s) => s.id === id)) throw new Error("空间不存在");
  await api.storage.local.set({ [SPACE_KEY]: id });
  spaceCtx = null;
}

export async function createSpace(name) {
  const { data, error } = await supabase.rpc("bsync_space_create", { p_name: name });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("plan_locked")) return { ok: false, reason: "plan_locked" };
    if (msg.includes("invalid_name")) return { ok: false, reason: "invalid_name" };
    if (msg.includes("duplicate key")) return { ok: false, reason: "duplicate" };
    return { ok: false, reason: "rpc_error", error: msg };
  }
  return { ok: true, space: data };
}

export async function deleteSpace(id) {
  const { error } = await supabase.rpc("bsync_space_delete", { p_space: id });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("cannot_delete_default")) return { ok: false, reason: "cannot_delete_default" };
    return { ok: false, reason: "rpc_error", error: msg };
  }
  const { activeSpaceId } = await api.storage.local.get(SPACE_KEY);
  if (activeSpaceId === id) await api.storage.local.remove(SPACE_KEY);
  spaceCtx = null;
  return { ok: true };
}

export async function renameSpace(id, name) {
  const { error } = await supabase.rpc("bsync_space_rename", { p_space: id, p_name: name });
  if (error) {
    const msg = error.message || "";
    if (msg.includes("invalid_name")) return { ok: false, reason: "invalid_name" };
    return { ok: false, reason: "rpc_error", error: msg };
  }
  return { ok: true };
}

// ============================================================
// 设备注册表：设备管理 + 多设备合并前的知情确认
// 设备名自动检测（浏览器 · 系统），无需用户手动命名
// ============================================================
let cachedDeviceName = null;

export async function listDevices() {
  const { data, error } = await supabase
    .from("bsync_devices")
    .select("device_id, name, last_space_id, last_sync_at, created_at")
    .order("last_sync_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

function detectBrowserName() {
  const ua = navigator.userAgent ?? "";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "浏览器";
}

function detectOsName() {
  const ua = navigator.userAgent ?? "";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

// 自动设备名：如 "Chrome · Windows"。首次同步时随 push 登记到设备注册表。
export async function getDeviceName() {
  if (cachedDeviceName) return cachedDeviceName;
  const os = detectOsName();
  cachedDeviceName = [detectBrowserName(), os].filter(Boolean).join(" · ");
  return cachedDeviceName;
}

export async function removeDevice(deviceId) {
  const { error } = await supabase.rpc("bsync_device_remove", { p_device: deviceId });
  if (error) throw new Error(error.message);
}

// ============================================================
// 首同步确认（设备 × 空间）：本设备第一次与某空间建立同步且双方都有书签时，
// 阻断同步等待用户选择（合并 / 远程覆盖本地 / 暂不同步）。
// 取代旧的账号级 mergeAck —— 确认的是「这棵树怎么处理」而非「有其他设备」。
// 判定信号 = 该空间没有 baseline；同步成功写入基线后自然不再触发。
// ack 键按 (userId, spaceId) 记录：合并确认后即使同步中途失败也不重复打断。
// ============================================================
async function firstSyncAckKey(spaceId) {
  const { data: session } = await supabase.auth.getSession();
  const uid = session?.session?.user?.id;
  return uid && spaceId ? `firstSyncAck:${uid}:${spaceId}` : null;
}

export async function isFirstSyncAcknowledged(spaceId) {
  const key = await firstSyncAckKey(spaceId);
  if (!key) return true;
  const res = await api.storage.local.get(key);
  return !!res[key];
}

export async function acknowledgeFirstSync(spaceId) {
  const key = await firstSyncAckKey(spaceId);
  if (key) await api.storage.local.set({ [key]: true });
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

// 节点内容身份：根桶 + type + title + url 的哈希（结构化，跨浏览器稳定）
// 桶标签由调用方显式传入（本地节点用 rootSync，sync 表示节点用 assignBuckets）。
// 不能用本地 path 判桶：服务端节点没有 path、只有 parent_sync_id，
// 文件夹子项两端会算出不同身份（BAR vs OTHER）导致永远对不齐、反复换 sync_id。
// 兼容性：旧格式对文件夹子项本就对不上（本地 "BAR/文件夹|hash" vs 服务端 "OTHER|hash"），
// 仅根级节点（path === "BAR"）的 identity 字符串在新格式下保持不变。
async function nodeIdentity(node, bucket) {
  const root = bucket ?? (node.rootSync === ROOT_OTHER ? "OTHER" : "BAR");
  const content = JSON.stringify([node.type ?? "bookmark", node.title ?? "", node.url ?? ""]);
  return `${root}|${await hashText(content)}`;
}

// 为 sync 表示节点数组（远端快照 / 三态合并结果）计算每个节点的根桶。
// 快照保持先序（父先于子），单趟递推：根级按 parent_sync_id，子级继承父桶。
function assignBuckets(nodes) {
  const bucketBySid = new Map();
  const buckets = new Map();
  for (const n of nodes) {
    let bucket;
    if (n.parent_sync_id === ROOT_BAR) bucket = "BAR";
    else if (n.parent_sync_id === ROOT_OTHER) bucket = "OTHER";
    else bucket = bucketBySid.get(n.parent_sync_id) ?? "OTHER";
    buckets.set(n, bucket);
    if (n.sync_id) bucketBySid.set(n.sync_id, bucket);
  }
  return buckets;
}

// ============================================================
// 本地持久化：映射 + 基线
// ============================================================
const MAPPING_KEY = "syncIdMaps";
const BASELINE_KEY = "lastSyncBaseline";
const LOCAL_TOMB_KEY = "localTombstones"; // [{sync_id, url}] 本设备删除过的节点

// 键按空间命名（spaceCtx 生效时加 :spaceId 后缀）；默认空间且无空间键时回退老键，
// 保证存量用户切换到「显式选择默认空间」后基线/映射不丢失
async function scopedGet(base) {
  const scoped = spaceScopedKey(base);
  const res = await api.storage.local.get([scoped, base]);
  if (res[scoped] !== undefined) return res[scoped];
  if (spaceCtx?.legacyFallback && res[base] !== undefined) return res[base];
  return undefined;
}

async function scopedSet(base, value) {
  await api.storage.local.set({ [spaceScopedKey(base)]: value });
}

async function loadMaps() {
  const m = await scopedGet(MAPPING_KEY);
  return m ?? { byNative: {}, bySync: {}, byIdentity: {} };
}
async function saveMaps(m) {
  await scopedSet(MAPPING_KEY, m);
}
async function loadBaseline() {
  const b = await scopedGet(BASELINE_KEY);
  return { nodes: b?.nodes ?? [], at: b?.at ?? 0 };
}
async function saveBaseline(nodes) {
  await scopedSet(BASELINE_KEY, { nodes, at: Date.now() });
}
async function loadLocalTombstones() {
  return (await scopedGet(LOCAL_TOMB_KEY)) ?? [];
}
async function saveLocalTombstones(list) {
  await scopedSet(LOCAL_TOMB_KEY, list);
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
  const remoteBuckets = assignBuckets(remoteNodes);
  for (const r of remoteNodes) {
    const ident = await nodeIdentity(r, remoteBuckets.get(r));
    if (!identityToSync.has(ident)) identityToSync.set(ident, r.sync_id);
  }
  // 再填充 baseline 身份（兜底：离线删除后重建的相同内容能找回原 sync_id）
  const baseBuckets = assignBuckets(baselineNodes ?? []);
  for (const b of baselineNodes ?? []) {
    const ident = await nodeIdentity(b, baseBuckets.get(b));
    if (!identityToSync.has(ident)) identityToSync.set(ident, b.sync_id);
  }

  // nativeId → sync_id（优先用映射；其次按身份对齐；最后新建）
  const nativeToSync = new Map();
  for (const ln of localFlat) {
    let sid = maps.byNative[ln.nativeId];
    if (!sid) {
      const ident = await nodeIdentity(ln, ln.rootSync === ROOT_OTHER ? "OTHER" : "BAR");
      sid = identityToSync.get(ident);
      if (sid) maps.byIdentity[ident] = sid;
      else {
        sid = newSyncId();
        maps.byIdentity[ident] = sid;
      }
    }
    nativeToSync.set(ln.nativeId, sid);
    // 映射必须当场落盘：此前只写 byIdentity，本地已有节点（identity 对齐来的）
    // 永远进不了 byNative，下一轮同步全部变成「无映射节点」而被误删
    maps.byNative[ln.nativeId] = sid;
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
async function applyNodes(nodes, maps) {
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
  const mergedBuckets = assignBuckets(nodes);
  const locByIdentity = new Map();
  for (const ln of localFlat) {
    locByIdentity.set(
      await nodeIdentity(ln, ln.rootSync === ROOT_OTHER ? "OTHER" : "BAR"),
      ln.nativeId
    );
  }

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
    // 无映射节点按「同桶 + 同内容」匹配：文件夹内书签的父是文件夹而非根，
    // 旧的 parent_sync_id === 根 判定会把它们全部误删
    const keep =
      sid === undefined
        ? sortedNodes.some(
            (n) =>
              n.type === ln.type &&
              n.url === ln.url &&
              n.title === ln.title &&
              mergedBuckets.get(n) === (ln.rootSync === ROOT_OTHER ? "OTHER" : "BAR")
          )
        : targetSyncIds.has(sid);
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
      const ident = await nodeIdentity({ type: n.type, title: n.title, url: n.url }, mergedBuckets.get(n));
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

// 首同步确认文案用：本机有、远端没有的书签条数（执行「远程覆盖本地」时将被删除的数量）。
// 身份判定规则与 applyNodes 保留规则一致（同桶 + 同 type/url/title），远端为空时即本地全部书签。
async function countLocalOnlyBookmarks(localFlat, remoteNodes) {
  const buckets = assignBuckets(remoteNodes);
  const remoteIdents = new Set();
  for (const r of remoteNodes) {
    remoteIdents.add(await nodeIdentity(r, buckets.get(r)));
  }
  let count = 0;
  for (const ln of localFlat) {
    if (ln.type !== "bookmark") continue;
    const ident = await nodeIdentity(ln, ln.rootSync === ROOT_OTHER ? "OTHER" : "BAR");
    if (!remoteIdents.has(ident)) count++;
  }
  return count;
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

// 本地基线中的服务端书签条数（type='bookmark'，按当前生效空间）。
// 基线 = 最近一次成功同步后的服务端快照（明文域存储）。作为服务端
// used_count（0016 迁移部署后返回）尚不可用时的展示回退：多空间账号
// 只统计当前空间，其他设备期间的同步也不反映，部署迁移后以服务端为准。
export async function countServerBookmarks() {
  try {
    const { spaces, active } = await getActiveSpace();
    if (!active) return 0;
    spaceCtx = { id: active.id, legacyFallback: !!active.is_default };
    try {
      const baseline = await loadBaseline();
      return baseline.nodes.filter((n) => n?.type === "bookmark").length;
    } finally {
      spaceCtx = null;
    }
  } catch {
    return null;
  }
}

/**
 * 执行同步（三态合并 / 并集）
 * @param {{force?: boolean}} opts force=true 跳过首同步确认（UI 确认「合并」后重入）
 * @returns {Promise<{ok, pushed, pulled, reason?, error?, size?, quota?, plan?, tombstones?, spaceId?,
 *                     localCount?, remoteCount?, localOnlyCount?, remoteEncrypted?, hasTombstones?}>}
 *   reason = "first_sync_confirm_needed" 时附双方条数（remoteEncrypted=true 时 remoteCount 未知为 null）
 */
export async function runSync(opts = {}) {
  const { data: session } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "unauthenticated" };

  // 解析同步空间：显式选择 > 服务端默认空间（pull 返回实际生效的 space_id）
  const { activeSpaceId } = await api.storage.local.get(SPACE_KEY);
  const { data: pullData, error: pullError } = await supabase.rpc("bsync_snapshot_pull", {
    p_space: activeSpaceId ?? null,
  });
  if (pullError) {
    console.warn("[sync] bsync_snapshot_pull failed:", pullError.message);
    return { ok: false, reason: "rpc_error", error: pullError.message };
  }
  const spaceId = pullData?.space_id ?? null;

  // 空间上下文决定 maps / baseline / 本地墓碑的存储命名空间；
  // 生效空间是默认空间时允许回退读老键（存量用户无感升级）
  let legacyFallback = true;
  try {
    const spaces = await listSpaces();
    const sp = spaces.find((s) => s.id === spaceId);
    legacyFallback = !sp || sp.is_default;
  } catch {}
  spaceCtx = { id: spaceId, legacyFallback };

  try {
    // 加密模式（可选项）：账号级，默认 E2EE。
    // 形态自动跟随 —— 以服务端已有数据形态为准，仅当首推（无远端数据）时用本地开关决定，
    // 保证同一账号多设备不会"一台加密一台明文"互相污染。
    //   - 远端是密文 → 解密路径（需密钥，缺则提示 decrypt_error）
    //   - 远端是明文 → 明文路径（不做加解密，等于关闭 E2EE）
    //   - 远端为空   → 按本地开关初始化首份数据

    // 1. 拉取远端（已在上方完成）
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
      // E2EE 边界：首同步（无基线）且远端是密文而本设备还没有密钥 → 无法解密也不应绕过，
      // 先引导导入密钥/口令，导入成功后重新同步即回到四象限决策
      if (!baseline.at && remoteIsCipher && !(await hasKey())) {
        return {
          ok: false,
          reason: "first_sync_confirm_needed",
          spaceId,
          localCount: localFlat.filter((n) => n.type === "bookmark").length,
          remoteCount: null,
          localOnlyCount: null,
          remoteEncrypted: true,
          hasTombstones: remoteTombstones.length > 0,
        };
      }
      keyBytes = await ensureKey();
      remoteNodes = await decryptNodes(rawRemote, keyBytes);
      if (remoteNodes == null) {
        return { ok: false, reason: "decrypt_error", error: "服务端数据无法解密，请检查是否已导入正确的同步密钥或口令" };
      }
    } else {
      remoteNodes = rawRemote;
    }

    // (设备 × 空间) 首同步判定：该空间没有 baseline = 本设备第一次与这棵树建立同步。
    // 四象限：
    //   本地空 || 远程空 → 自动放行（并集合并天然就是「自动拉取」/「自动推送」，无需特殊代码）；
    //   双方都有书签 → 唯一打断点，弹确认（合并 / 远程覆盖本地 / 暂不同步）。
    //   例外：远程空但存在墓碑 → 可能有设备刻意清空过账号，自动推送会灌入不要的数据，改走确认。
    //   同步成功后写入 baseline，之后正常增量同步永不再触发；已确认过（ack）也放行。
    if (!baseline.at && !opts.force && !(await isFirstSyncAcknowledged(spaceId))) {
      const localCount = localFlat.filter((n) => n.type === "bookmark").length;
      const remoteCount = remoteNodes.filter((n) => n.type === "bookmark").length;
      const clearedRemote = remoteCount === 0 && remoteTombstones.length > 0;
      if (localCount > 0 && (remoteCount > 0 || clearedRemote)) {
        return {
          ok: false,
          reason: "first_sync_confirm_needed",
          spaceId,
          localCount,
          remoteCount,
          localOnlyCount: await countLocalOnlyBookmarks(localFlat, remoteNodes),
          remoteEncrypted: false,
          hasTombstones: remoteTombstones.length > 0,
        };
      }
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
      p_space: spaceId,
      p_device_name: (await getDeviceName()) || null,
    });
    if (pushError) {
      const msg = pushError.message || "";
      console.warn("[sync] bsync_snapshot_push failed:", msg);
      if (msg.includes("quota_exceeded")) return { ok: false, reason: "quota_exceeded" };
      return { ok: false, reason: "rpc_error", error: msg };
    }

    // 6. 成功后重新拉取服务端实际快照作为 baseline
    //    （服务端会过滤墓碑，merged ≠ 服务端实际存储；用实际快照才能正确区分下次的"删除"与"未推送"）
    const { data: afterPull } = await supabase.rpc("bsync_snapshot_pull", { p_space: spaceId });
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
      spaceId,
    };
  } finally {
    spaceCtx = null;
  }
}

// 为兼容 background.js 的事件墓碑语义留存（新引擎不依赖其单独维护）
export async function recordTombstone() {}
export async function clearTombstone() {}

// ============================================================
// 远程覆盖本地（首同步确认的选项之一，也可视为一次性「拉取覆盖」）
// 路径：pull → applyNodes（目标集之外的本地节点被删除）→ 基线重置为远端 → push 一次登记设备。
// 注意：被覆盖删除的本地节点不产生墓碑（基线里本就没有它们）——覆盖是本机行为，不传播删除。
// ============================================================
export async function pullOverwriteLocal() {
  const { data: session } = await supabase.auth.getSession();
  if (!session) return { ok: false, reason: "unauthenticated" };

  const { activeSpaceId } = await api.storage.local.get(SPACE_KEY);
  const { data: pullData, error: pullError } = await supabase.rpc("bsync_snapshot_pull", {
    p_space: activeSpaceId ?? null,
  });
  if (pullError) {
    console.warn("[sync] bsync_snapshot_pull failed:", pullError.message);
    return { ok: false, reason: "rpc_error", error: pullError.message };
  }
  const spaceId = pullData?.space_id ?? null;

  let legacyFallback = true;
  try {
    const spaces = await listSpaces();
    const sp = spaces.find((s) => s.id === spaceId);
    legacyFallback = !sp || sp.is_default;
  } catch {}
  spaceCtx = { id: spaceId, legacyFallback };

  try {
    const rawRemote = pullData?.bookmarks ?? [];
    const remoteIsCipher = rawRemote.some((n) => isEncrypted(n?.title) || isEncrypted(n?.url));
    let keyBytes = null;
    let remoteNodes;
    if (remoteIsCipher) {
      keyBytes = await ensureKey();
      remoteNodes = await decryptNodes(rawRemote, keyBytes);
      if (remoteNodes == null) {
        return { ok: false, reason: "decrypt_error", error: "服务端数据无法解密，请检查是否已导入正确的同步密钥或口令" };
      }
    } else {
      remoteNodes = rawRemote;
    }

    const maps = await loadMaps();
    const changes = await applyNodes(remoteNodes, maps);

    // push 一次与远端一致的内容（密文形态原样推回）：登记本设备 + 刷新 used_bytes
    const { error: pushError } = await supabase.rpc("bsync_snapshot_push", {
      p_data: rawRemote,
      p_tombstones: [],
      p_device: await getDeviceId(),
      p_space: spaceId,
      p_device_name: (await getDeviceName()) || null,
    });
    if (pushError) {
      const msg = pushError.message || "";
      if (msg.includes("quota_exceeded")) return { ok: false, reason: "quota_exceeded" };
      return { ok: false, reason: "rpc_error", error: msg };
    }

    await saveBaseline(remoteNodes); // 基线重置为远端（明文域）
    await saveLocalTombstones([]);
    return { ok: true, pulled: changes, spaceId };
  } finally {
    spaceCtx = null;
  }
}