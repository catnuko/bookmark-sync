// store.js — 共享响应式状态 + 全部 UI 动作（弹窗 / 设置页共用）
// 说明：popup.html 与 options.html 各自独立挂载 App，模块级单例在各自页面
// 内共享；不跨页面通信（页面间依赖 chrome.storage / Supabase 作为权威）。
import { reactive, computed } from "vue";
import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import {
  getProfile, countServerBookmarks,
  getActiveSpace, switchSpace, createSpace, deleteSpace, renameSpace,
  listDevices, removeDevice, getDeviceId,
  acknowledgeFirstSync, pullOverwriteLocal,
  resetSyncState, resetCoordinator,
} from "./sync.js";
import { exportKey, importKey, hasKey, setKeyFromPassphrase } from "./crypto.js";

// ---- 常量 ----
export const ONBOARD_SKIP_KEY = "crdt.onboardSkipped";
export const AUTO_SYNC_KEY = "crdt.autoSync";
const GC_DEFAULT = 2000;

// ---- 状态 ----
export const state = reactive({
  // auth
  session: null,
  email: "",
  password: "",
  mode: "login", // 'login' | 'register'
  busy: false,
  authError: "",
  authSuccess: "",

  // sync 状态（由 storage 权威回填）
  syncBusy: false,
  status: "",
  lastSyncAt: null,
  lastSyncStatus: "",
  lastDecryptErrors: null,

  // 密钥
  keyValue: "",
  keyImportInput: "",
  keyMsg: "",
  keyPhraseInput: "",
  hasKeyNow: false,
  keyStateLoaded: false,

  // 付费档案
  profile: null, // { plan, quota_bytes, used_bytes, used_count?, purchased_at }
  serverCount: null, // 基线回退：最近一次同步后的服务端书签条数
  showUpgradeModal: false,
  checkoutBusy: false,

  // 空间 / 设备
  spaces: [],
  activeSpace: null,
  devices: [],
  myDeviceId: "",
  newSpaceName: "",
  spaceBusy: false,
  creatingSpace: false, // 「新建空间」行展开态
  renamingId: "",
  renameInput: "",

  // 危险操作两步确认（armed 目标 key + 3 秒递减倒计时）
  armed: "",
  armedLeft: 3,
  resetBusy: false,
  resetMsg: "",

  // 首同步决策
  showFirstSyncModal: false,
  firstSyncInfo: null, // { localCount, remoteCount, localOnlyCount, remoteEncrypted, hasTombstones, spaceId }
  overwriteArmed: false,
  overwriteLeft: 3,
  firstSyncKeyInput: "",
  firstSyncPhraseInput: "",
  firstSyncKeyMsg: "",

  // 新设备密钥引导
  showOnboard: false,
  onboardMode: "", // '' | 'key' | 'phrase'
  onboardKeyInput: "",
  onboardPhraseInput: "",
  onboardMsg: "",

  // 弹窗二级面板（抽屉）
  drawer: "", // '' | 'spaces' | 'key'

  // 设置页导航
  navPane: "account", // 'account' | 'sync' | 'spaces' | 'crypto' | 'advanced' | 'help'

  // 自动同步开关
  autoSync: true,

  // 共存与存储（GC）
  gcThresholdInput: "",
  lastGcAt: null,

  // toast 队列
  toasts: [],
});

// ---- 计时器句柄（页面级单例） ----
let armedTimer = null;
let overwriteTimer = null;

// ---- Toast ----
export function showToast(level, title, sub = "") {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.toasts.push({ id, level, title, sub });
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id);
    if (i >= 0) state.toasts.splice(i, 1);
  }, 3200);
}

// ---- 危险操作两步确认：首次点击进入 armed 倒计时（3→1），再次点击执行 ----
function armStart(key) {
  state.armed = key;
  state.armedLeft = 3;
  clearInterval(armedTimer);
  armedTimer = setInterval(() => {
    state.armedLeft -= 1;
    if (state.armedLeft <= 0) {
      state.armed = "";
      clearInterval(armedTimer);
      armedTimer = null;
    }
  }, 1000);
}
export function disarmAction() {
  clearInterval(armedTimer);
  armedTimer = null;
  state.armed = "";
  state.armedLeft = 3;
}
export function armAction(key, onConfirm) {
  if (state.armed !== key) {
    armStart(key);
    return;
  }
  disarmAction();
  onConfirm();
}

// ---- 同步密钥 ----
export async function refreshKeyState() {
  try {
    state.hasKeyNow = await hasKey();
  } catch {
    state.hasKeyNow = false;
  }
  state.keyStateLoaded = true;
}

export async function loadKeyPanel() {
  // 注意：exportKey() 内部会调 ensureKey() 自动生成密钥，因此无密钥时不能调它，
  // 否则用户只是看一眼密钥面板就被动生成了一把密钥，与提示文字矛盾。
  const has = await hasKey();
  state.keyMsg = has ? "" : "本设备尚无密钥，首次同步时自动生成；换设备时请在此导入同一密钥。";
  state.keyValue = has ? await exportKey() : "";
  state.hasKeyNow = has;
  state.keyStateLoaded = true;
}

export async function copyKey() {
  if (!state.keyValue) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(state.keyValue);
  } catch { /* 剪贴板受限时静默 */ }
  state.keyMsg = "密钥已复制，请妥善保管（丢失后无法解密既有数据）。";
  showToast("info", "密钥已复制", "请妥善保管——丢失后无法解密既有数据。");
}

export async function doImportKey() {
  const ok = await importKey(state.keyImportInput);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.keyMsg = "密钥已导入。同步时即可解密换设备同步来的书签。";
    state.keyImportInput = "";
    state.keyValue = await exportKey();
    state.hasKeyNow = true;
    showToast("success", "密钥已导入", "同步时即可解密换设备同步来的书签。");
  } else {
    state.keyMsg = "密钥格式不正确，请确认粘贴的是完整的 44 字符密钥。";
    showToast("danger", "密钥格式不正确", "请确认粘贴的是完整的 44 字符密钥。");
  }
}

export async function doSetKeyByPhrase() {
  const phrase = state.keyPhraseInput;
  if (!phrase || phrase.length < 8) {
    state.keyMsg = "口令至少 8 位，且要够长/独特才安全。";
    showToast("danger", "口令至少 8 位", "且要够长/独特才安全。");
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.keyMsg = "已用口令设定密钥。新装一台设备时，输入同一口令即可解密同步数据。⚠️ 请务必牢记口令。";
    state.keyPhraseInput = "";
    state.keyValue = await exportKey();
    state.hasKeyNow = true;
    showToast("success", "已用口令设定密钥", "新装设备输入同一口令即可解密同步数据。请牢记口令——忘记将无法找回。");
  } else {
    state.keyMsg = "口令长度不足，未设置。";
    showToast("danger", "口令长度不足", "未设置。");
  }
}

// ---- 新设备引导 ----
export async function maybeOpenOnboard() {
  if (state.showOnboard || state.showFirstSyncModal) return;
  const has = await hasKey();
  const { [ONBOARD_SKIP_KEY]: skipped } = await api.storage.local.get(ONBOARD_SKIP_KEY);
  if (!has && !skipped) {
    state.onboardMode = "";
    state.onboardMsg = "";
    state.showOnboard = true;
  }
}

export async function onboardImportKey() {
  const ok = await importKey(state.onboardKeyInput);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.onboardMsg = "密钥已导入，可以开始同步了。";
    setTimeout(() => { state.showOnboard = false; }, 1200);
  } else {
    state.onboardMsg = "密钥格式不正确，请粘贴完整的 44 字符密钥。";
  }
}

export async function onboardSetPhrase() {
  const phrase = state.onboardPhraseInput;
  if (!phrase || phrase.length < 8) {
    state.onboardMsg = "口令至少 8 位，且要够长、独特才安全。";
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.onboardMsg = "已用口令设定密钥。⚠️ 请牢记口令——忘记将无法解密既有数据，且无法找回。";
    setTimeout(() => { state.showOnboard = false; }, 1600);
  } else {
    state.onboardMsg = "口令设置失败，请重试。";
  }
}

export function skipOnboard() {
  state.showOnboard = false;
  api.storage.local.set({ [ONBOARD_SKIP_KEY]: true });
  showToast("info", "已跳过密钥设置", "之后不再自动提醒；可随时打开「同步密钥」或「帮助」设置。");
}

// ---- 空间 / 设备 ----
export async function refreshSpacesDevices() {
  try {
    const { spaces: sp, active } = await getActiveSpace();
    state.spaces = sp;
    state.activeSpace = active;
    state.devices = await listDevices();
    state.myDeviceId = await getDeviceId();
  } catch (e) {
    console.warn("[store] refreshSpacesDevices failed:", e?.message ?? e);
  }
}

export async function doSwitchSpace(sp) {
  if (sp.id === state.activeSpace?.id) return;
  await switchSpace(sp.id);
  await refreshSpacesDevices();
  showToast("info", `已切换到空间「${sp.name}」`, "下次同步将与该空间的数据按并集合并（本设备书签会并入该空间）。");
}

export async function doCreateSpace() {
  if (!state.newSpaceName.trim() || state.spaceBusy) return;
  state.spaceBusy = true;
  try {
    const r = await createSpace(state.newSpaceName);
    if (!r.ok && r.reason === "plan_locked") {
      state.showUpgradeModal = true;
      showToast("warning", "空间数量已达上限", "升级可获得更多空间");
      return;
    }
    if (!r.ok && r.reason === "duplicate") {
      showToast("danger", "已存在同名空间", "");
      return;
    }
    if (!r.ok) {
      showToast("danger", `创建失败: ${r.error ?? r.reason}`, "");
      return;
    }
    state.newSpaceName = "";
    state.creatingSpace = false;
    await refreshSpacesDevices();
    showToast("success", "空间已创建", "点击空间名即可切换");
  } finally {
    state.spaceBusy = false;
  }
}

export function startRename(sp) {
  state.renamingId = sp.id;
  state.renameInput = sp.name;
}

export async function submitRename(sp) {
  const name = state.renameInput.trim();
  if (!name || name === sp.name) {
    state.renamingId = "";
    return;
  }
  const r = await renameSpace(sp.id, name);
  state.renamingId = "";
  if (!r.ok) {
    showToast("danger", `重命名失败: ${r.error ?? r.reason}`, "");
    return;
  }
  await refreshSpacesDevices();
  showToast("success", "已重命名", "");
}

export async function doDeleteSpace(sp) {
  armAction(`space:${sp.id}`, async () => {
    const r = await deleteSpace(sp.id);
    if (!r.ok && r.reason === "cannot_delete_default") {
      showToast("danger", "默认空间不可删除", "");
      return;
    }
    if (!r.ok) {
      showToast("danger", `删除失败: ${r.error ?? r.reason}`, "");
      return;
    }
    await refreshSpacesDevices();
    showToast("success", `空间「${sp.name}」已删除`, "");
  });
}

export async function doRemoveDevice(d) {
  armAction(`device:${d.device_id}`, async () => {
    try {
      await removeDevice(d.device_id);
      await refreshSpacesDevices();
      showToast("success", "已解除该浏览器的同步", "其删除记录一并清除。");
    } catch (e) {
      showToast("danger", `移除失败: ${e?.message ?? e}`, "");
    }
  });
}

// ---- 设备名展示 ----
function baseDeviceName(d) {
  const raw = d.name || "";
  if (!raw || raw === d.device_id || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return "";
  }
  return raw;
}

function shortTag(id) {
  let h = 0;
  const s = String(id ?? "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(4, "0").slice(-4).toUpperCase();
}

const dupDeviceNames = computed(() => {
  const m = new Map();
  for (const d of state.devices) {
    const n = baseDeviceName(d) || `未知设备 · ${shortTag(d.device_id)}`;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
});

export function deviceLabel(d) {
  const known = baseDeviceName(d);
  const name = known || `未知设备 · ${shortTag(d.device_id)}`;
  return (dupDeviceNames.value.get(name) ?? 0) > 1 ? `${name} · ${shortTag(d.device_id)}` : name;
}

// 设备最近同步的空间名（用户心智是「哪台浏览器在对哪棵树干活」）
export function deviceSpaceName(d) {
  if (!d.last_space_id) return "";
  const sp = state.spaces.find((s) => s.id === d.last_space_id);
  return sp ? sp.name : "";
}

export function deviceCountForSpace(spaceId) {
  return state.devices.filter((d) => d.last_space_id === spaceId).length;
}

// ---- 付费 / 配额 ----
export async function refreshProfile() {
  state.profile = await getProfile();
  if (!(state.profile && typeof state.profile.used_count === "number")) {
    state.serverCount = await countServerBookmarks();
  }
}

export async function startCheckout(plan) {
  if (state.checkoutBusy) return;
  state.checkoutBusy = true;
  try {
    const { data, error } = await supabase.functions.invoke("bsync-creem-checkout", {
      body: { plan },
    });
    const url = data?.checkout_url;
    if (error || !url) {
      showToast("danger", "创建支付会话失败", data?.message ?? error?.message ?? "请稍后重试");
      return;
    }
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
    state.showUpgradeModal = false;
    showToast("info", "已打开支付页面", "完成后回到这里点「立即同步」即可生效");
  } catch (e) {
    showToast("danger", "创建支付会话失败", e?.message ?? e);
  } finally {
    state.checkoutBusy = false;
  }
}

export async function manageSubscription() {
  try {
    const { data, error } = await supabase.functions.invoke("bsync-creem-portal", {
      body: {},
    });
    const url = data?.portal_url;
    if (error || !url) {
      showToast("danger", "打开订阅管理失败", data?.message ?? error?.message ?? "请稍后重试");
      return;
    }
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  } catch (e) {
    showToast("danger", "打开订阅管理失败", e?.message ?? e);
  }
}

export function openUpgrade() {
  state.showUpgradeModal = true;
}

// ---- 首同步决策 ----
export async function firstSyncMerge() {
  const spaceId = state.firstSyncInfo?.spaceId;
  state.showFirstSyncModal = false;
  if (spaceId) await acknowledgeFirstSync(spaceId);
  await syncNow({ force: true });
}

export function firstSyncOverwrite() {
  if (!state.overwriteArmed) {
    state.overwriteArmed = true;
    state.overwriteLeft = 3;
    clearInterval(overwriteTimer);
    overwriteTimer = setInterval(() => {
      state.overwriteLeft -= 1;
      if (state.overwriteLeft <= 0) {
        state.overwriteArmed = false;
        clearInterval(overwriteTimer);
        overwriteTimer = null;
      }
    }, 1000);
    return;
  }
  state.overwriteArmed = false;
  clearInterval(overwriteTimer);
  overwriteTimer = null;
  doOverwriteLocal();
}

async function doOverwriteLocal() {
  state.showFirstSyncModal = false;
  state.syncBusy = true;
  try {
    const r = await pullOverwriteLocal();
    if (r.ok) {
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: "已按云端覆盖本机",
      });
      await refreshStatus();
      showToast("success", "完成", "已按云端覆盖本机书签");
      await refreshProfile();
      await refreshSpacesDevices();
    } else if (r.reason === "decrypt_error") {
      showToast("danger", "云端数据无法解密", r.error ?? "请检查同步密钥");
    } else if (r.reason === "quota_exceeded") {
      state.showUpgradeModal = true;
      showToast("warning", "空间不足", "请升级到 Plus 或 Pro");
    } else {
      showToast("danger", `覆盖失败: ${r.error ?? r.reason}`, "");
    }
  } catch (e) {
    showToast("danger", `失败: ${e?.message ?? e}`, "");
  } finally {
    state.syncBusy = false;
  }
}

export function dismissFirstSync() {
  state.showFirstSyncModal = false;
  showToast("info", "已暂不同步", "下次同步时会再次询问如何处理。");
}

export async function importFirstSyncKey() {
  const ok = await importKey(state.firstSyncKeyInput);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.firstSyncKeyMsg = "";
    state.firstSyncKeyInput = "";
    state.showFirstSyncModal = false;
    await syncNow({});
  } else {
    state.firstSyncKeyMsg = "密钥格式不正确，请确认粘贴的是完整的 44 字符密钥。";
  }
}

export async function phraseFirstSyncKey() {
  const phrase = state.firstSyncPhraseInput;
  if (!phrase || phrase.length < 8) {
    state.firstSyncKeyMsg = "口令至少 8 位，且要够长/独特才安全。";
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.firstSyncKeyMsg = "";
    state.firstSyncPhraseInput = "";
    state.showFirstSyncModal = false;
    await syncNow({});
  } else {
    state.firstSyncKeyMsg = "口令长度不足，未设置。";
  }
}

// ---- 同步 ----
export async function refreshStatus(extra) {
  const s = await api.storage.local.get(["lastSyncAt", "lastSyncStatus", "lastDecryptErrors"]);
  state.lastSyncAt = s.lastSyncAt ?? null;
  state.lastSyncStatus = s.lastSyncStatus ?? "";
  state.lastDecryptErrors = s.lastDecryptErrors ?? null;
  if (extra) showToast("info", extra);
}

// 把 runSync 返回的 {pushed, pulled, seeded, decryptFailed} 翻译成用户能理解的自然语言。
// 注意：pushed/pulled 是 CRDT 操作行数（一个书签的建/移/改会产 2~3 条 op，
// 冷启动重放还会把历史 op 全计一遍），和「书签数」不是一回事，直接展示会让用户
// 误以为传了 N 个书签。这里只描述方向与结果，不展示原始 op 数。
function syncSummary(r) {
  const p = r.pushed || 0;
  const q = r.pulled || 0;
  const warn = r.decryptFailed > 0
    ? ` · ⚠️ ${r.decryptFailed} 条云端数据解密失败（密钥不匹配，请检查同步密钥/口令）`
    : "";
  let body;
  if (r.seeded) body = "首次同步完成，书签已加密上传";
  else if (r.restored) body = "首次同步完成，已从云端恢复书签";
  else if (p > 0 && q > 0) body = "双向同步完成";
  else if (p > 0) body = "已上传本地变更";
  else if (q > 0) body = "已同步其他设备的变更";
  else body = "已是最新";
  return body + warn;
}

export async function syncNow(opts = {}) {
  // 注意：模板 @click 直传时 opts 可能是事件对象，统一归一化为 force 布尔
  const force = opts === true || !!opts?.force;
  state.syncBusy = true;
  try {
    // 同步在 SW 内执行（SW 是同步权威，事件桥与 coordinator 同 realm）。
    // 60s 兜底超时，避免 SW 未启动时无限「同步中…」。
    const msgResult = new Promise((resolve) => {
      try {
        api.runtime.sendMessage({ type: "bsync-sync", force }, (resp) => {
          resolve(resp ?? { ok: false, reason: "no_response" });
        });
      } catch (e) {
        resolve({ ok: false, reason: "error", error: String(e) });
      }
    });
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ ok: false, reason: "timeout", error: "Service Worker 未响应" }), 60000)
    );
    const r = await Promise.race([msgResult, timeout]);
    if (!r.ok && r.reason === "first_sync_confirm_needed") {
      // 本设备第一次与该空间同步且需要决策（双方都有书签 / 云端密文待导密钥）
      state.firstSyncInfo = r;
      state.overwriteArmed = false;
      state.firstSyncKeyMsg = "";
      state.showFirstSyncModal = true;
      showToast("info", r.remoteEncrypted ? "云端数据已加密，请先导入同步密钥" : "本机与云端都有书签，请确认如何同步", "");
      return;
    }
    if (!r.ok && r.reason === "no_key") {
      // 本机还没有同步口令：弹出引导让用户设置（新设备/重装后必须输入口令）
      state.onboardMode = "phrase";
      state.onboardMsg = "";
      state.showOnboard = true;
      showToast("info", "请先设置同步口令", "新设备输入与其他设备相同的口令即可同步");
      return;
    }
    if (!r.ok && r.reason === "quota_exceeded") {
      // 空间不足，弹升级 modal
      state.showUpgradeModal = true;
      showToast("warning", "空间不足", "请升级到 Plus 或 Pro");
      return;
    }
    if (!r.ok && r.reason === "decrypt_error") {
      // 端到端加密：密钥不匹配 / 数据损坏，引导用户导入密钥
      showToast("danger", "数据无法解密", r.error ?? "请检查同步密钥");
      return;
    }
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: r.ok
        ? syncSummary(r)
        : `${r.reason}${r.error ? ` (${r.error})` : ""}`,
    });
    await refreshStatus();
    if (r.ok) {
      showToast("success", "同步完成", syncSummary(r));
    } else {
      showToast("danger", `${r.reason}${r.error ? ` (${r.error})` : ""}`, "");
    }
    // 同步后刷新配额与空间/设备状态（push 会登记本设备）。
    // 兜底超时：popup 的 supabase 查询偶尔挂起（网络/会话竞争），
    // 不能让「同步中…」永久卡住——同步本身已完成（storage 已更新）。
    if (r.ok) {
      await Promise.race([
        Promise.all([refreshProfile(), refreshSpacesDevices()]),
        new Promise((resolve) => setTimeout(resolve, 15000)),
      ]);
    }
  } catch (e) {
    showToast("danger", `失败: ${e?.message ?? e}`, "");
  } finally {
    state.syncBusy = false;
  }
}

// ---- 自动同步开关 ----
export async function loadAutoSync() {
  const s = await api.storage.local.get(AUTO_SYNC_KEY);
  state.autoSync = s[AUTO_SYNC_KEY] !== false;
}

export async function toggleAutoSync() {
  state.autoSync = !state.autoSync;
  await api.storage.local.set({ [AUTO_SYNC_KEY]: state.autoSync });
  showToast(
    "info",
    state.autoSync ? "已开启自动同步" : "已关闭自动同步",
    state.autoSync ? "检测到变更后自动在后台同步" : "本地变更将不再自动上传，可随时手动「立即同步」"
  );
}

// ---- 共存与存储（GC） ----
export async function loadCoexistPanel() {
  const s = await api.storage.local.get(["crdt.gcThreshold", "lastGcAt"]);
  state.gcThresholdInput = String(s["crdt.gcThreshold"] ?? GC_DEFAULT);
  state.lastGcAt = s["lastGcAt"] ?? null;
}

export async function saveGcThreshold() {
  const v = parseInt(state.gcThresholdInput, 10);
  if (!Number.isFinite(v) || v < 0) {
    showToast("danger", "GC 阈值须为非负整数", "0 = 关闭 GC");
    return;
  }
  await api.storage.local.set({ "crdt.gcThreshold": v });
  await loadCoexistPanel();
  showToast("success", `已保存 GC 阈值 ${v}`, "0 = 关闭");
}

// ---- 测试工具：一键清空云端测试数据 + 本机缓存 + 登出 ----
export async function resetTestData() {
  if (state.resetBusy) return;
  state.resetBusy = true;
  state.resetMsg = "正在清空云端数据...";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("未登录");
    const uid = session.user.id;

    // 按外键顺序删除当前用户的所有同步数据
    const { data: spaces } = await supabase
      .from("bsync_spaces").select("id").eq("owner_id", uid);
    const spaceIds = (spaces ?? []).map(s => s.id);

    if (spaceIds.length > 0) {
      await supabase.from("bsync_snapshots").delete().in("space_id", spaceIds);
      await supabase.from("bsync_op_log").delete().in("space_id", spaceIds);
      await supabase.from("bsync_devices").delete().in("space_id", spaceIds);
      await supabase.from("bsync_spaces").delete().in("id", spaceIds);
    }
    // 重置 profile（盐/用量清零）
    await supabase.from("bsync_profiles")
      .update({ e2ee_salt: null, used_count: 0, used_bytes: 0 })
      .eq("user_id", uid);

    state.resetMsg = "云端已清空，正在清除本机缓存并登出...";
    await resetSyncState();
    // 通知 SW 也重置 coordinator 单例（否则 SW 内存中仍持有旧 afterId）
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" }).catch(() => {});
    await supabase.auth.signOut();

    state.resetMsg = "完成！云端数据、本机缓存与登录态已清空，可重新登录测试。";
    // 刷新 UI 状态（onAuthStateChange 会自动切回登录页，这里兜底清状态）
    state.session = null;
    state.profile = null;
    state.spaces = [];
    state.activeSpace = null;
    state.devices = [];
    state.serverCount = null;
    state.status = "";
  } catch (e) {
    state.resetMsg = "失败：" + (e?.message ?? String(e));
  } finally {
    state.resetBusy = false;
  }
}

// ---- 登录 / 注册 / 登出 ----
export async function submit() {
  state.busy = true;
  state.authError = "";
  state.authSuccess = "";
  try {
    const em = state.email.trim();
    const pw = state.password;
    if (!em || !pw) {
      state.authError = "请输入邮箱和密码";
      return;
    }
    let res;
    if (state.mode === "register") {
      res = await supabase.auth.signUp({ email: em, password: pw });
      if (res.error) {
        state.authError = `注册失败: ${res.error.message}`;
        return;
      }
      if (!res.data.session) {
        state.session = null;
        state.authSuccess = "注册成功，请查收确认邮件后登录";
        return;
      }
    } else {
      res = await supabase.auth.signInWithPassword({ email: em, password: pw });
      if (res.error) {
        state.authError = `登录失败: ${res.error.message}`;
        return;
      }
    }
    state.session = res.data.session;
    // 记住邮箱，方便下次登录（密码不落盘）
    await api.storage.local.set({ rememberEmail: em });
    await refreshStatus();
    await refreshProfile();
    // 登录成功后自动触发一次同步：消除登录前的失败状态残留（如 onStartup
    // 未登录时记录的 not_authenticated），同时让 SW 中的 supabase 客户端
    // 通过 ensureSession 兜底恢复 session。
    syncNow();
  } finally {
    state.busy = false;
  }
}

export async function logout() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  state.serverCount = null;
  state.spaces = [];
  state.devices = [];
  state.activeSpace = null;
  state.drawer = "";
  state.armed = "";
  state.status = "已退出登录";
  showToast("info", "已退出登录", "");
}

// ---- 弹窗抽屉 / 设置页导航 ----
export function openDrawer(name) {
  state.drawer = name;
  if (name === "spaces") refreshSpacesDevices();
  if (name === "key") loadKeyPanel();
}
export function closeDrawer() {
  state.drawer = "";
}

export function openHelp() {
  // 帮助放设置页「帮助」分区；弹窗打开时跳转设置页对应分区
  if (api.tabs?.create) {
    api.tabs.create({ url: api.runtime.getURL("options.html#help") });
  }
}
export function openSettings() {
  if (api.runtime?.openOptionsPage) {
    api.runtime.openOptionsPage();
  } else if (api.tabs?.create) {
    api.tabs.create({ url: api.runtime.getURL("options.html") });
  }
}

// ---- 初始化（App onMounted 调用） ----
export async function init(popup) {
  if (popup) document.body.classList.add("popup");
  // 设置页支持 #help 直达帮助分区
  if (!popup && location.hash === "#help") {
    state.navPane = "help";
  }
  // 记住上次登录的邮箱（只存邮箱，不存密码），退出登录后自动填充
  const { rememberEmail } = await api.storage.local.get("rememberEmail");
  if (rememberEmail) state.email = rememberEmail;
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) {
    await Promise.all([refreshStatus(), refreshProfile(), refreshSpacesDevices(), loadAutoSync(), loadCoexistPanel(), refreshKeyState()]);
    maybeOpenOnboard();
  }
  supabase.auth.onAuthStateChange(async (_e, s) => {
    state.session = s;
    if (s) {
      await Promise.all([refreshStatus(), refreshProfile(), refreshSpacesDevices(), loadAutoSync(), loadCoexistPanel(), refreshKeyState()]);
      maybeOpenOnboard();
    } else {
      state.profile = null;
      state.serverCount = null;
      state.spaces = [];
      state.devices = [];
      state.activeSpace = null;
      state.drawer = "";
    }
  });
}

// ---- 计算属性（模板直接引用） ----
export const userEmail = computed(() => state.session?.user?.email ?? "");
export const displayName = computed(() => {
  const em = userEmail.value;
  if (!em) return "";
  return em.split("@")[0] || em;
});

export const planLabel = computed(() => {
  const p = state.profile?.plan;
  if (p === "pro" || p === "lifetime") return "Pro";
  if (p === "plus" || p === "premium") return "Plus";
  return "Free";
});

// 额度按「条」展示（与定价一致：Free 500 / Plus 10,000 / Pro·Lifetime 不限）。
// 已用条数优先取服务端 used_count（0016 迁移），未部署时回退本地基线统计。
export const usedCount = computed(() => {
  if (state.profile && typeof state.profile.used_count === "number") {
    return state.profile.used_count;
  }
  return state.serverCount;
});

export const quotaCount = computed(() => {
  const p = state.profile?.plan;
  if (p === "pro" || p === "lifetime") return null; // 不限数量
  return p === "plus" || p === "premium" ? 10000 : 500;
});

export const usagePct = computed(() => {
  if (!quotaCount.value || usedCount.value == null) return 0;
  return Math.min(100, Math.round((usedCount.value / quotaCount.value) * 100));
});

export const quotaState = computed(() => {
  if (usedCount.value == null || !quotaCount.value) return "ok";
  const pct = (usedCount.value / quotaCount.value) * 100;
  if (pct >= 100) return "over";
  if (pct >= 90) return "warn";
  return "ok";
});

export const quotaBadge = computed(() => {
  if (quotaState.value === "over") return { text: "已超出配额", cls: "badge-danger" };
  if (quotaState.value === "warn") return { text: "接近上限", cls: "badge-warning" };
  return { text: planLabel.value.toUpperCase(), cls: "badge-neutral" };
});

export const quotaFoot = computed(() => {
  const spaceName = state.activeSpace?.name ?? "";
  if (quotaState.value === "over") return `已超出配额 ${((usedCount.value ?? 0) - quotaCount.value).toLocaleString()} 条 · 请升级后继续同步`;
  if (quotaState.value === "warn") return `仅剩 ${(quotaCount.value - usedCount.value).toLocaleString()} 条 · 超出后新书签将无法同步`;
  const remain = quotaCount.value
    ? `剩余 ${(quotaCount.value - usedCount.value).toLocaleString()} 条`
    : "数量不限";
  return spaceName ? `当前空间：${spaceName} · ${remain}` : remain;
});

export const quotaBtn = computed(() => {
  const p = state.profile?.plan;
  if (!p || p === "free") return "upgrade";
  return "manage";
});

// 同步状态卡：syncing / ok / error / never
export const syncState = computed(() => {
  if (state.syncBusy) return "syncing";
  if (!state.lastSyncAt) return "never";
  const st = state.lastSyncStatus ?? "";
  if (st.startsWith("未同步") || st.startsWith("失败")) return "error";
  return "ok";
});

export const syncTitle = computed(() => {
  switch (syncState.value) {
    case "syncing": return "正在同步…";
    case "never": return "尚未同步";
    case "error": return "同步失败";
    default: return "已同步";
  }
});

export const syncSub = computed(() => {
  const st = state.lastSyncStatus ?? "";
  if (syncState.value === "syncing") return "正在上传本地变更…";
  if (syncState.value === "never") return "点击下方按钮开始首次同步";
  if (syncState.value === "error") {
    // 去掉「未同步: / 失败: 」前缀，保留可读原因
    const clean = st.replace(/^(未同步|失败):\s*/, "");
    return clean || "网络异常，请检查连接后重试";
  }
  const decrypt = state.lastDecryptErrors?.errors?.length;
  if (decrypt) return `${decrypt} 条云端数据解密失败（密钥不匹配）`;
  return `${usedCount.value ?? 0} 条书签 · 已加密上传`;
});

export const syncTail = computed(() => {
  if (syncState.value === "never") return "未登记";
  return fmtRelative(state.lastSyncAt);
});

export function fmtRelative(ts) {
  if (!ts) return "从未";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return fmt(ts);
}

export function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : "从未";
}

// 空间数量档位：Free 1 · Plus 3 · Pro/Lifetime 10
export const spaceLimit = computed(() => {
  const p = state.profile?.plan;
  if (p === "pro" || p === "lifetime") return 10;
  if (p === "plus" || p === "premium") return 3;
  return 1;
});
