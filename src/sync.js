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
import { t } from "./lib/i18n.js";
import {
  SupabaseOpLogTransport,
  SyncCoordinator,
  MemoryOpLogTransport,
  captureLocalEvents,
  captureLocalTree as captureUnmappedTree,
  IdBridge,
  IS_FIREFOX,
  resolveSpaceLanding,
  persistSpaceLanding,
  loadSpaceRoots,
  SPACE_ROOTS_KEY,
  reverseApply,
} from "./sync/index.js";
import { KeyManager } from "./sync/index.js";
import {
  BOOKMARKS_BAR_UUID,
  MENU_UUID,
  MOBILE_UUID,
  OTHER_BOOKMARKS_UUID,
  ROOT_UUID,
  openBookmarkDb,
  OutboxStore,
} from "./crdt/index.js";

const DEVICE_ID_KEY = "crdt.deviceId";
/**
 * 按空间分区的持久化键（B2 多空间：每个空间各自一套水位/计数器/映射）。
 * 项目未上架、无历史部署，故不做「历史全局键继承」——旧的 `crdt.afterId` /
 * `crdt.counter` / `crdt.idmap` 单键只在 resetSyncState 里当垃圾清理。
 */
const AFTER_ID_PREFIX = "crdt.afterId.";
const COUNTER_PREFIX = "crdt.counter.";
const IDMAP_PREFIX = "crdt.idmap.";
/** 历史（全局）键：仅 resetSyncState 清理用。 */
const LEGACY_KEYS = ["crdt.afterId", "crdt.counter", "crdt.idmap"];
/** 当前活动空间（多空间切换写入此键；getActiveSpace 读它）。 */
const ACTIVE_SPACE_KEY = "activeSpaceId";
/** op-log GC 阈值（storage 键可覆盖；E2E 注入小阈值验证 GC 链路）。 */
const GC_THRESHOLD_KEY = "crdt.gcThreshold"; // 历史遗留 key，仅 resetSyncState 清理用

/** Chromium 端 MENU_UUID（书签菜单）动态容器的持久化 chromeId。 */
const MENU_FOLDER_KEY = "crdt.menuFolderId";
const MENU_FOLDER_TITLE = "书签菜单";

/** 按空间分区的键名（多空间下每个空间各自一套水位/计数器/映射）。 */
const afterIdKey = (spaceId) => AFTER_ID_PREFIX + spaceId;
const counterKey = (spaceId) => COUNTER_PREFIX + spaceId;
const idmapKey = (spaceId) => IDMAP_PREFIX + spaceId;

/** chrome.storage.local 适配器（空间落地区/注册表用）。 */
const landingStorage = {
  async get(key) {
    return api.storage.local.get(key);
  },
  async set(obj) {
    return api.storage.local.set(obj);
  },
};

/** 删除所有以 prefix 开头的按空间键（换密钥 / 一键重置用）。 */
async function removeAllScoped(prefix) {
  try {
    const all = await api.storage.local.get();
    const keys = Object.keys(all ?? {}).filter((k) => k.startsWith(prefix));
    if (keys.length) await api.storage.local.remove(keys);
  } catch { /* storage 不可用时忽略 */ }
}

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
  const { [ACTIVE_SPACE_KEY]: savedId } = await api.storage.local.get(ACTIVE_SPACE_KEY);
  let active = spaces.find((s) => s.id === savedId) ?? null;
  let fellBack = false;
  if (!active) {
    // 未切换过 / 该空间已被删除 / 未登录过：回落到默认空间（首个空间）。
    active = spaces.find((s) => s.is_default) ?? spaces[0] ?? null;
    fellBack = true;
  }
  // 选定结果落盘：让「当前空间」成为本机的持久状态（UI 徽标 + 同步目标一致），
  // 也避免每次都走回退分支。
  if (active && (fellBack || savedId !== active.id)) {
    await api.storage.local.set({ [ACTIVE_SPACE_KEY]: active.id });
  }
  return { spaces, active };
}

// 把 RPC 错误归一化为 { ok:false, reason, error }。
// 后端 RAISE EXCEPTION '<code>' 的 message 即 reason（plan_locked /
// cannot_delete_default / invalid_name / not_found）；唯一索引冲突（23505）
// 归一为 duplicate，与 store.js 的 reason 分支对齐。
function spaceRpcError(err) {
  if (!err) return { ok: false, reason: "unknown", error: "unknown error" };
  const msg = err.message || "";
  if (err.code === "23505") return { ok: false, reason: "duplicate", error: msg };
  // RAISE EXCEPTION 的自定义 code 直接作为 reason
  // （0032：quota_exceeded / rate_limited；0033：device_limit_reached）
  for (const code of [
    "plan_locked", "cannot_delete_default", "invalid_name", "not_found", "not_authenticated",
    "quota_exceeded", "rate_limited", "device_limit_reached",
  ]) {
    if (msg.includes(code)) return { ok: false, reason: code, error: msg };
  }
  return { ok: false, reason: msg, error: msg };
}

export async function createSpace(name) {
  const { data, error } = await supabase.rpc("bsync_space_create", { p_name: name });
  if (error) return spaceRpcError(error);
  return { ok: true, space: data };
}

export async function renameSpace(id, name) {
  const { error } = await supabase.rpc("bsync_space_rename", { p_space: id, p_name: name });
  if (error) return spaceRpcError(error);
  return { ok: true };
}

export async function deleteSpace(id) {
  const { error } = await supabase.rpc("bsync_space_delete", { p_space: id });
  if (error) return spaceRpcError(error);
  return { ok: true };
}

/**
 * 切换活动空间（B2 多容器并存）。
 *
 * 语义：切换只改「同步目标 + 本机投影落地区」，本地书签不销毁不重建——旧空间
 * 的落地树原样留在本机（其容器），新空间的容器按需建立。这与文案「切换空间即
 * 切换同步上下文」一致，同时避免 B1 式「切换时整棵替换本机书签」带来的误删风险。
 *
 * 前置条件（用户要求）：旧空间的本地变更必须**推送成功**后才允许切换。推不动
 * （离线 / 额度超限 / 服务端拒绝）就不切，把失败原因交回 UI——否则本地改动会
 * 停在「已入队未推送」的中间态，用户以为已经切走了。
 *
 * 由 SW（background）执行：只有 SW 持有与事件桥同 realm 的 coordinator 单例。
 */
export async function switchSpace(id) {
  const cur = getCoordinatorCached();
  if (cur && cur.spaceId !== id) {
    await flushPersist(); // 未推送 op 先落 outbox（IndexedDB），推送失败也不丢
    if (!(await drainPush(cur))) {
      return { ok: false, reason: "push_failed" };
    }
  }
  await flushPersist();
  await api.storage.local.set({ [ACTIVE_SPACE_KEY]: id });
  // 丢弃缓存的 coordinator 与映射桥：下次同步按新空间重建（水位/计数器/映射
  // 都按空间分区，各自续拉，不互相污染）。
  _coordinator = null;
  _bootPromise = null;
  _coordinatorGen++;
  dropBridgeCache();
  console.log(`[bsync] 已切换活动空间 → ${id}`);
  return { ok: true };
}

/**
 * 把某空间的未推送 op 推完（含等待并发中的 flushPush），超时/失败返回 false。
 *
 * `flushPush` 在「已有推送在途」时直接返回 0（防重入），所以必须轮询到
 * pendingPush 真的空——否则会在有在途推送时误判「已推完」而放行切换。
 */
async function drainPush(coordinator, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pendingCount(coordinator) === 0) return true;
    try {
      await coordinator.flushPush();
      await api.storage.local.set({ [counterKey(coordinator.spaceId)]: coordinator.replica.counter });
      await api.storage.local.set({ [afterIdKey(coordinator.spaceId)]: coordinator.afterId });
    } catch (e) {
      console.warn(`[bsync] 切换空间前推送失败: ${e?.message ?? e}`);
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

function pendingCount(coordinator) {
  return coordinator?.pendingPush?.length ?? 0;
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

export async function renameDevice(deviceId, name) {
  const { error } = await supabase.rpc("bsync_device_rename", { p_device: deviceId, p_name: name });
  if (error) return spaceRpcError(error);
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
async function ensureSession() {
  const { data: sess } = await supabase.auth.getSession();
  if (sess?.session) return sess.session;
  try {
    const key = supabase.auth.storageKey;
    const raw = await api.storage.local.get(key);
    const stored = raw[key];
    if (stored && stored.access_token && stored.refresh_token) {
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });
      if (!error && data.session) return data.session;
    }
  } catch { /* 兜底失败按未登录处理 */ }
  return null;
}

// ---- 同步主入口 ----
// 返回 { ok, pushed, pulled, reason?, error? }
//
// 事件桥（registerLocalEventBridge）在 SW 顶层注册 chrome.bookmarks 监听，
// 本地变更 → coordinator 入队 → flushSoon 去抖推送；本函数负责周期/手动全量
// 同步：拉远端 → 播种（仅云端为空且本机未播种时）→ 推本地。
export async function runSync(_opts = {}) {
  const runGen = _coordinatorGen;
  try {
    // SW 冷启动 / 跨上下文登录态脱节：用 ensureSession 兜底，避免 popup 已登录
    // 但 SW 内存 session 为 null 时误报 not_authenticated。
    const sess = await ensureSession();
    if (!sess) {
      // 已知原因不附带 error 文案：展示层（store.reasonText）按 reason 码本地化，
      // 避免「请先在插件中登录 (请先在插件中登录)」式重复。
      return { ok: false, reason: "not_authenticated" };
    }

    let { spaces, active } = await getActiveSpace();
    if (!active) {
      // 新用户无需手动建空间：首次同步自动创建「默认空间」（后端
      // bsync_space_create 首个空间自动 is_default=true）。后续推送/拉取
      // 以此为落点。
      const r = await createSpace("默认空间");
      if (!r.ok) return { ok: false, reason: "no_space", error: r.error ?? t("err_noSpace") };
      ({ spaces, active } = await getActiveSpace());
      if (!active) return { ok: false, reason: "no_space" };
    }

    const deviceId = await getDeviceId();
    const key = await keyManager.ensureKey();
    if (!key) {
      // 不再自动生成随机密钥：必须由用户设置口令派生。无密钥时直接拒绝同步，
      // 由 UI 引导用户在口令门禁页输入口令（文案按 reason 码在展示层本地化）。
      return { ok: false, reason: "no_key" };
    }

    // 设备心跳（0033：新设备首次登记超计划上限时服务端 raise device_limit_reached）
    const { error: touchError } = await supabase.rpc("bsync_device_touch", {
      p_space: active.id,
      p_device: deviceId,
      p_name: await detectDeviceName(),
    });
    if (touchError && String(touchError.message ?? "").includes("device_limit_reached")) {
      return { ok: false, reason: "device_limit_reached", error: touchError.message };
    }

    // 活动空间的映射桥 / 落地区 / 水位都按空间分区（多空间前提）：先确立活动
    // 桥（默认空间 = 原生根；其它空间 = 书签栏下的容器，必要时创建），事件
    // 处理器与 capture/reverseApply 后续都取它。
    await ensureActiveBridge(active, spaces);

    const coordinator = await getCoordinator(active.id, deviceId, key);
    console.log(`[bsync] === 同步开始 === space=${active.id} device=${deviceId} afterId=${coordinator.afterId} bare=${coordinator.replica.isBare()}`);


    // 冷启动保护：MV3 SW 闲置终止后重建的 replica 只有固定根（isBare），
    // 或持有 outbox 恢复的 op（needsColdReplay，同样只有部分状态）。此时
    // 必须先从基线恢复，否则 reverseApply 的空/缺历史 CRDT 视图会把本机
    // 书签树当「已删除」清空（removeTrashedNodes 误删）。基线优先取 GC
    // 快照（快照存在且可用 → 重建 + 增量；op 已被截断时 pullFrom(0) 会漏
    // 行）；无快照时退回全量重放 pullFrom(0)。
    // 累计本次同步所有阶段的解密失败（冷启动重放 + 主 pull），
    // 统一用于：是否跳过 used_count 上报、是否在 popup 显示警告。
    const allDecryptErrors = [];

    // 记录本次同步开始时本机是否还没有云端水位（afterId=0）。
    // 若随后从云端拉到了历史数据，这是「新设备首次从云端恢复书签」，
    // 而不是「其他设备新增了变更」——文案要区分。
    const hadNoWatermark = coordinator.afterId === 0;

    if (coordinator.afterId > 0 && coordinator.needsColdReplay) {
      const replay = await coordinator.pullWithSnapshot(true);
      if (replay.applied > 0) await api.storage.local.set({ [afterIdKey(active.id)]: coordinator.afterId });
      if (replay.decryptErrors?.length) allDecryptErrors.push(...replay.decryptErrors);
      console.log(`[bsync] 冷启动重放: applied=${replay.applied} decryptErrors=${replay.decryptErrors?.length ?? 0} afterId=${coordinator.afterId}`);
    }

    // 1) 拉远端 → 本地 CRDT（快照优先：快照新于本地水位时重建 + 增量）
    const pull = await coordinator.pullWithSnapshot(false);
    if (pull.decryptErrors?.length) allDecryptErrors.push(...pull.decryptErrors);
    console.log(`[bsync] 拉取: applied=${pull.applied} skipped=${pull.skipped ?? 0} decryptErrors=${pull.decryptErrors?.length ?? 0} afterId=${coordinator.afterId}`);
    if (pull.decryptErrors?.length) console.log("[bsync]   解密失败行:", JSON.stringify(pull.decryptErrors));

    // 诊断：解密失败（密钥不匹配）时持久化详情，popup 可展示警告
    if (allDecryptErrors.length) {
      await api.storage.local.set({ lastDecryptErrors: { errors: allDecryptErrors.slice(0, 5), at: Date.now() } });
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
        const { data: maxRow } = await supabase.from("bsync_op_log").select("id").eq("space_id", active.id).order("id", { ascending: false }).limit(1).maybeSingle();
        const maxId = maxRow?.id ?? 0;
        if (maxId > 0 && maxId < coordinator.afterId) {
          console.log(`[bsync] afterId 自愈: 远端最大 id=${maxId} < 本地 afterId=${coordinator.afterId}，重置为 0`);
          coordinator.afterId = 0;
          const rePull = await coordinator.pullWithSnapshot(false);
          if (rePull.decryptErrors?.length) allDecryptErrors.push(...rePull.decryptErrors);
          pull.applied = rePull.applied;
        }
      } catch { /* 探测失败不阻塞 */ }
    }

    // 空间已在本次同步途中被切换（用户在同步进行中点了切换 / 换了密钥）：
    // 立刻停手。继续跑下去，后面的 ensureActiveBridge 会把「活动映射桥」重新
    // 指回旧空间——随后到达的本地事件就会把新空间容器里的书签捕获进旧空间
    // （跨空间串味）。旧空间的 op 已由 switchSpace 落盘 + 推完，不会丢。
    if (runGen !== _coordinatorGen) {
      console.log("[bsync] 同步途中空间已切换，放弃本轮投影");
      return { ok: true, pushed: 0, pulled: pull.applied, superseded: true };
    }

    // 2) 重扫描本地树（每轮执行，幂等）：为未映射节点补建 MoveOp。
    //    替代旧「仅云端为空时播种」——批量导入中途关浏览器、事件被静默丢弃
    //    （父未映射/未设口令窗口/SW 冷启动竞态）、第二台设备本地书签（云端
    //    非空时旧实现不播种），这些孤儿在旧实现下永不同步。重扫描让「任一
    //    设备有而服务端没有的都保留」（并集合并）真正成立。
    //    didSeedThisRun 仅用于 UI 一次性提示（首台设备云端为空时的首次上传）。
    const captured = await captureLocalTree(coordinator, active, spaces);
    const didSeedThisRun = captured > 0 && hadNoWatermark && pull.applied === 0;
    if (captured > 0) {
      console.log(`[bsync] 本地重扫描: 补建 ${captured} 条 op, pending ops=${coordinator.pendingPush?.length ?? 0}`);
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
    await reverseApplyIntoChrome(coordinator, active, spaces);
    console.log("[bsync] 反向应用完成");

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
        console.warn(`[bsync] 跳过 GC：${allDecryptErrors.length} 条解密失败，replica 不完整（防止快照丢失数据）`);
        await api.storage.local.set({
          lastGcSkipped: { reason: "decrypt_failed", errors: allDecryptErrors.length, at: Date.now() },
        });
      } else {
        try {
          const gc = await coordinator.maybeGc();
          if (gc.gced) {
            await api.storage.local.set({ lastGcAt: Date.now() });
            await api.storage.local.remove("lastGcSkipped");
          } else if (gc.reason === "replica_incomplete") {
            // 协调器层守卫兜底（如快照基线解不开）：同样不生成投影
            console.warn("[bsync] 跳过 GC：replica 不完整（快照基线不可用）");
            await api.storage.local.set({
              lastGcSkipped: { reason: "replica_incomplete", at: Date.now() },
            });
          }
        } catch { /* GC 失败不阻塞同步 */ }
      }
    }

    // 6) 上报本机书签数（服务端 used_count 口径：快照加密后服务端无法自算）
    // 关键：pull 有解密失败时 CRDT 不完整，绝不能上报 used=0 覆盖之前的正确值——
    // 否则用户会看到额度从 N/500 跳成 0/500。
    if (allDecryptErrors.length) {
      console.log(`[bsync] 跳过 used_count 上报 (${allDecryptErrors.length} 条解密失败, CRDT 不完整)`);
      await api.storage.local.set({ lastUsedReport: { skipped: true, reason: "decrypt_failed", visibleNodes: coordinator.replica.getVisibleTree().length, at: Date.now() } });
    } else {
      try {
        let used = 0;
        const visible = coordinator.replica.getVisibleTree();
        for (const edge of visible) {
          if (typeof edge.meta?.url === "string" && edge.meta.url) used++;
        }
        console.log(`[bsync] 上报 used_count=${used} (visibleNodes=${visible.length})`);
        await supabase.rpc("bsync_profile_set_used", { p_used: used });
        await api.storage.local.set({ lastUsedReport: { used, visibleNodes: visible.length, at: Date.now() } });
      } catch (e) {
        try { await api.storage.local.set({ lastUsedReportError: e?.message ?? String(e) }); } catch {}
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
    return { ok: true, pushed, pulled: pull.applied, seeded: didSeedThisRun, restored, decryptFailed: allDecryptErrors.length };
  } catch (e) {
    // 服务端语义码直接作为 reason（push/pull 抛出的 PostgREST 错误 message
    // 即服务端 raise 的码：0032 quota_exceeded / rate_limited，0033 device_limit_reached），
    // 由 store.js 映射为按档位区分的升级 / 清理指引。
    const msg = String(e?.message ?? e);
    for (const code of ["quota_exceeded", "rate_limited", "device_limit_reached"]) {
      if (msg.includes(code)) {
        try { await api.storage.local.set({ lastSyncError: msg }); } catch {}
        return { ok: false, reason: code, error: msg };
      }
    }
    // 诊断：持久化完整错误与堆栈（readStorageLocal 可读）
    try {
      await api.storage.local.set({ lastSyncError: `${e?.message ?? e} | ${e?.stack ?? ''}` });
    } catch {}
    return { ok: false, reason: "error", error: e?.message ?? String(e) };
  }
}

// ---- 事件桥接线（background.js 顶层调用）----
// MV3 要求 chrome.* 事件监听在 SW 顶层注册；coordinator 未就绪（未登录/无空间）
// 时事件安全跳过，下次 runSync 的重扫描兜底。
let bridgeRegistered = false;
let _coordinator = null; // 惰性单例（按 spaceId 缓存）
let _coordinatorGen = 0; // 递增世代：resetCoordinator 后旧 boot 不再覆盖单例
let _eventGuard = { suppressed: { value: false } }; // captureLocalEvents 返回的 suppressed 标志

export function registerLocalEventBridge() {
  if (bridgeRegistered) return;
  bridgeRegistered = true;
  // 映射桥按空间多变，事件处理器经 getter 取「当前活动空间」的映射表
  // （bootCoordinatorForEvent 解析出空间时会一并确立 _activeBridge）。
  const bridgeGetter = () => getActiveBridge();
  // 冷启动防丢事件：coordinator 未就绪（SW 刚被事件唤醒、runSync 尚未跑）时
  // 懒启动一个 coordinator，而不是静默丢弃本地事件。否则 SW 冷窗口内的删除
  // 不产生墓碑，「立即同步」的全量重放会把已删除节点拉回来。
  _eventGuard = captureLocalEvents(
    globalThis.chrome?.bookmarks,
    () => getCoordinatorCached() ?? bootCoordinatorForEvent(),
    bridgeGetter,
    flushSoon,
  );
}

/** 惰性单例：事件到达时 coordinator 未创建 → 启动一个（登录态 + 空间 + 密钥）。 */
let _bootPromise = null;
function bootCoordinatorForEvent() {
  if (_coordinator) return _coordinator;
  if (!_bootPromise) {
    _bootPromise = (async () => {
      const gen = _coordinatorGen;
      try {
        // 冷启动防丢事件：SW 刚被事件唤醒时 supabase session 是异步从
        // storage 恢复的（与 runSync 3afd01d 同一问题）。不先确认 session，
        // getActiveSpace 会用 anon 查询被 RLS 拦 → active=null → 事件被丢
        // （典型表现：Firefox 闲置终止后再建书签，同步时该书签不出现）。
        const sess = await ensureSession();
        if (!sess) {
          return null; // 未登录：无可同步对象，事件跳过是正确行为
        }
        const { spaces, active } = await getActiveSpace();
        if (!active) return null; // 未登录/无空间：无可同步对象，事件跳过是正确行为
        const deviceId = await getDeviceId();
        const key = await keyManager.ensureKey();
        if (!key) return null; // 未设置口令：事件跳过，等用户设置后同步兜底
        if (gen !== _coordinatorGen) return null; // 密钥已变更，放弃本次 boot
        // 先确立该空间的落地区与映射桥：事件处理器随后经 getActiveBridge() 取用，
        // 否则冷启动窗口内的事件会拿不到映射而漏掉（典型：删除事件丢墓碑）。
        await ensureActiveBridge(active, spaces);
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
 * 只能写进本空间的落地区：默认空间 = 原生根，容器空间 = 容器文件夹。跨空间共用
 * 一张映射表会让 B 空间把 A 空间「已映射但不可达」的节点判为待删（本机书签被
 * 清空），所以这里取活动空间自己的桥，并且在落地根之外一律不写。
 */
async function reverseApplyIntoChrome(coordinator, space, spaces) {
  const chrome = globalThis.chrome?.bookmarks;
  if (!chrome) return;
  const bridge = await ensureActiveBridge(space, spaces);
  const landing = _activeLanding;
  const guard = _eventGuard ?? { suppressed: { value: false } };
  // 注意：事件闭包读的是 guard.suppressed.value（captureLocalEvents 返回
  // { suppressed: {value} }），直接设 guard.value 会静默失效——这正是
  // reverseApply 回环（每次同步复制一批书签）的根因。
  guard.suppressed.value = true; // 抑制事件回环（create/move/update 会触发 onCreated 等）
  try {
    if (landing?.mode === "native" && !IS_FIREFOX) {
      // 默认空间 + Chromium：MENU_UUID 容器按需存在（原生根里没有「书签菜单」
      // 这个位置，只能挂在书签栏下）。仅当 CRDT 中「书签菜单」有实际子节点
      // （Firefox 菜单有书签并同步过来）时才创建。
      const menuHasChildren = coordinator.replica
        .getVisibleTree()
        .some((e) => e.parent === MENU_UUID);
      if (menuHasChildren) {
        await ensureMenuFolder(coordinator, bridge);
      }
    }
    await reverseApply(chrome, coordinator, bridge);
    if (landing?.mode === "native") {
      if (!IS_FIREFOX) {
        // 同步收敛后：若「书签菜单」容器已空，移除容器，让 Chrome 端只在
        // Firefox 菜单有书签时显示它。
        await cleanupEmptyMenuContainer(bridge);
      }
    } else {
      // 容器空间：固定根子文件夹（书签栏/其他书签/移动设备书签/书签菜单）
      // 按需存在——空了就删，不留空文件夹。
      await cleanupEmptyLandingFolders(bridge);
    }
    await api.storage.local.set({ [idmapKey(space.id)]: bridge.snapshot() });
    await persistLandingRow(space, bridge);
  } finally {
    guard.suppressed.value = false;
  }
}

/**
 * 容器空间：把「固定根子文件夹空了」的落地区删掉（按需落地语义）。
 * 容器本身（ROOT 落地）永不在此删除——它是空间的根，删了整棵落地树就没了。
 */
async function cleanupEmptyLandingFolders(bridge) {
  const chrome = globalThis.chrome?.bookmarks;
  if (!chrome) return;
  for (const uuid of [BOOKMARKS_BAR_UUID, OTHER_BOOKMARKS_UUID, MOBILE_UUID, MENU_UUID]) {
    const cid = bridge.toChromeId(uuid);
    if (!cid) continue;
    try {
      const kids = await chrome.getChildren(cid);
      if (kids && kids.length > 0) continue; // 仍有内容，保留
      await chrome.removeTree(cid);
      bridge.removeByChromeId(cid);
    } catch {
      /* 容器状态异常时忽略，下轮同步再处理 */
    }
  }
}

/** 把本空间当前落地映射写回容器注册表（子文件夹是按需创建的，必须落盘）。 */
async function persistLandingRow(space, bridge) {
  if (space?.is_default) return; // 默认空间落地 = 原生根，无需登记
  try {
    const registry = _bridges.get(space.id)?.registry ?? (await loadSpaceRoots(landingStorage));
    const sub = {};
    for (const uuid of [BOOKMARKS_BAR_UUID, OTHER_BOOKMARKS_UUID, MOBILE_UUID, MENU_UUID]) {
      const cid = bridge.toChromeId(uuid);
      if (cid) sub[uuid] = cid;
    }
    await persistSpaceLanding(landingStorage, space, registry, {
      rootId: bridge.toChromeId(ROOT_UUID) ?? null,
      sub,
    });
  } catch { /* 注册表写失败不阻塞同步（下次解析会重建） */ }
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
      } catch { /* 漏删由服务端 (space,device,seq) 幂等去重兜底 */ }
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
  } catch { /* IndexedDB 不可用：退回内存队列行为 */ }
  return _coordinator;
}

// ── 本地变更持久化 tick ─────────────────────────────────────────────────
// 单一 300ms 去抖 tick 同时落盘三件事：outbox 未推送 op（IndexedDB）、
// IDMAP 快照（chromeId↔uuid）、Lamport counter。成对落盘是崩溃安全的关键：
// 若只有映射落盘而 op 丢失，「已映射但 CRDT 不可达」会让 reverseApply 把
// 本地书签误删；顺序固定为 outbox 先、IDMAP 后——残余崩溃窗口（亚毫秒级）
// 的最坏情况是重复书签（可恢复），绝不是数据丢失。
let persistTimer = null;
let persistRunning = false;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, 300);
}

let _outboxStore = null;
async function getOutboxStore() {
  if (!_outboxStore) {
    const db = await openBookmarkDb(globalThis.indexedDB);
    _outboxStore = new OutboxStore(db);
  }
  return _outboxStore;
}

async function flushPersist() {
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
      } catch { /* IndexedDB 不可用：退回内存队列行为，重扫描兜底 */ }
    }
    // IDMAP / counter 按空间分区落盘（与 outbox 的 spaceId 维度一致）。
    const entry = _bridges.get(c.spaceId);
    await api.storage.local.set({
      [idmapKey(c.spaceId)]: entry ? entry.bridge.snapshot() : {},
      [counterKey(c.spaceId)]: c.replica.counter,
    });
  } catch { /* 持久化失败不阻塞同步 */ } finally {
    persistRunning = false;
  }
}

/**
 * chromeId↔uuid 映射桥：**按空间一个实例**（多空间隔离），内存 + 
 * chrome.storage.local `crdt.idmap.<spaceId>` 持久化（重启不丢）。
 *
 * 为什么必须按空间：同一 chromeId 在不同空间是不同节点。共用一个映射表时，
 * 切到空间 B 后本地节点全部「已映射」→ 不为 B 建任何 op（与「本设备书签并入
 * 该空间」的文案相反）→ B 的 CRDT 只有固定根 → reverseApply 把「已映射但不
 * 可达」的节点全部 removeTree（本机书签被清空）。
 *
 * 落地区（B2 多容器并存）：默认空间 = 原生根；其它空间 = 书签栏下的容器
 * 「书签空间 · <空间名>」（见 sync/spaceLanding.ts）。落地形态变了就重建桥，
 * 桥里已有的映射先落盘再重建，避免丢映射导致重复捕获。
 */
const _bridges = new Map(); // spaceId -> { bridge, sig, landing, registry }
/** 事件桥使用的「当前活动空间」映射表（runSync / 懒启动时确立）。 */
let _activeBridge = null;
/** 活动空间的落地区（用于区分原生模式/容器模式的按需行为）。 */
let _activeLanding = null;

/**
 * 建立（或复用）活动空间的映射桥，并解析其落地区。
 *
 * 每次同步都重新解析落地：用户可能删掉/重建过容器。落地根签名不变时复用内存
 * 中的桥（保留映射），变了就重建并重新载入持久化映射。
 */
async function ensureActiveBridge(space, spaces = []) {
  const all = spaces.length ? spaces : [space];
  const { landing, registry } = await resolveSpaceLanding({
    chrome: globalThis.chrome?.bookmarks,
    storage: landingStorage,
    space,
    spaces: all,
    containerTitle: t("spaces_containerTitle", space.name ?? ""),
    isFirefox: IS_FIREFOX,
  });
  const sig = JSON.stringify([space.is_default ? 1 : 0, landing.roots, landing.foreignRoots]);
  // 竞态护栏：解析落地时可能刚 chrome.create 出本空间的容器，onCreated 事件会在
  // 「_activeBridge 还没换过来」的窗口里落到**上一个**活动空间的桥上。把它先登记
  // 成上一个空间的外来根，避免上一个空间把新容器当成自己的书签文件夹捕获进 CRDT。
  if (_activeBridge && _activeBridge.spaceId !== space.id && landing.rootId) {
    _activeBridge.addForeignRoot(landing.rootId);
  }
  const cached = _bridges.get(space.id);
  if (cached && cached.sig === sig) {
    cached.registry = registry;
    _activeBridge = cached.bridge;
    _activeLanding = landing;
    return cached.bridge;
  }
  // 重建前先把旧桥的映射落盘，避免重建丢映射（下次 capture 会重复建节点）。
  if (cached) {
    try {
      await api.storage.local.set({ [idmapKey(space.id)]: cached.bridge.snapshot() });
    } catch { /* 落盘失败：重建后由 capture 兜底（最坏是重复节点，不会丢数据） */ }
  }
  const bridge = new IdBridge(() => schedulePersist(), {
    spaceId: space.id,
    roots: landing.roots,
    foreignRoots: landing.foreignRoots,
    nativeRoots: landing.mode === "native",
  });
  // 冷启动竞态修复：idMap 恢复是异步的，必须等 load 完成后再 reverseApply /
  // capture，否则映射缺失会让 reverseApply 把「已存在的书签」当「缺失」重复
  // 创建（SW 每次冷启动/回收后同步都复制一批书签）。
  try {
    const res = await api.storage.local.get(idmapKey(space.id));
    const map = res[idmapKey(space.id)];
    if (map) bridge.load(map);
  } catch { /* storage 不可用：本轮按空映射处理 */ }
  _bridges.set(space.id, { bridge, sig, landing, registry });
  _activeBridge = bridge;
  _activeLanding = landing;
  return bridge;
}

function getActiveBridge() {
  return _activeBridge;
}

/** 切换空间 / 重置后丢弃缓存的映射表（下次按新空间重建并重新载入）。 */
function dropBridgeCache(spaceId) {
  if (spaceId) _bridges.delete(spaceId);
  else _bridges.clear();
  _activeBridge = null;
  _activeLanding = null;
}

/**
 * 重扫描本机 chrome 书签树：为未映射节点补建 op（每轮同步执行，幂等）。
 * 遍历核心在 chromeBridge.captureLocalTree（可独立测试）；此处负责落地区解析、
 * 映射载入，以及捕获结果的立即落盘——outbox 先、IDMAP 后（成对语义见
 * flushPersist 注释），不等 300ms tick，避免大批量捕获的持久化空窗。
 *
 * 只走本空间的落地根：容器外的书签不属于本空间，绝不捕获（否则切空间会把
 * 原生书签栏里的内容吸进容器空间）。
 */
export async function captureLocalTree(coordinator, space, spaces = []) {
  // 不知道是哪个空间就不知道落地区在哪——宁可不捕获，也绝不退回「遍历整棵树」
  // （那会把别的空间的书签吸进本空间）。调用方都是 runSync，一定带 space。
  if (!space?.id) return 0;
  const bridge = await ensureActiveBridge(space, spaces);
  if (!globalThis.chrome?.bookmarks) return 0;
  const captured = await captureUnmappedTree(
    globalThis.chrome.bookmarks,
    coordinator,
    bridge,
    _activeLanding?.rootId,
  );
  if (captured > 0) await flushPersist();
  return captured;
}

/** 事件入队后去抖 flush（2s），实现「自动无感同步」。 */
let flushTimer = null;
const AUTO_SYNC_KEY = "crdt.autoSync";
export function flushSoon() {
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

// ── 密钥变更后重置 coordinator（让下次同步用新密钥重建）──────────────────
// 导入密钥 / 用口令设置密钥后，SyncCoordinator 内存中仍缓存旧 CryptoKey，
// 必须置空单例，下次 bootCoordinatorForEvent 会用 storage 中的新密钥重建。
export function resetCoordinator() {
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
// 清除本机所有同步相关缓存（CRDT 计数器/水位/UUID映射/落地区/密钥/播种标记
// 等），并重置内存中的 coordinator 单例。不会删除 chrome.bookmarks 里的书签，
// 也不会登出 Supabase 账号。配合「清空云端测试数据」使用，可从零重测。
//
// 注意：重置后本机空间容器不再被登记，下次同步会按需重建容器并把云端书签
// 重新投影进去（容器内原有的本地书签会被重新捕获成新节点，故重置前后请勿
// 期待「原样保留」——重置的本质就是从零重测）。
export async function resetSyncState() {
  _coordinator = null;
  _coordinatorGen++;
  dropBridgeCache();
  const keys = [
    DEVICE_ID_KEY, SPACE_ROOTS_KEY, "crdt.seeded",
    MENU_FOLDER_KEY, GC_THRESHOLD_KEY, ACTIVE_SPACE_KEY,
    "crdt.e2eeKey", "crdt.e2eeSalt", "crdt.onboardSkipped",
    "lastSyncStatus", "lastSyncAt", "lastSyncError", "lastDecryptErrors",
    "lastUsedReport", "lastUsedReportError", "lastGcAt", "lastGcSkipped",
    "activeSpace",
    ...LEGACY_KEYS,
  ];
  await api.storage.local.remove(keys);
  // 按空间分区的键（水位/计数器/映射）：逐前缀清理
  await removeAllScoped(AFTER_ID_PREFIX);
  await removeAllScoped(COUNTER_PREFIX);
  await removeAllScoped(IDMAP_PREFIX);
  // 清除 IndexedDB 中的 CRDT 持久化状态（ops/snapshot/uuidMapping/meta）
  try {
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase("bookmark-crdt-sync");
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
      req.onblocked = resolve;
    });
  } catch (e) {
    console.warn("[bsync] resetSyncState: IndexedDB 删除失败:", e?.message);
  }
}
// 供测试：暴露内存传输 + 协调器类型（避免重复实例化）。
export { MemoryOpLogTransport };
