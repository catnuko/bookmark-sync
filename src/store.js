// store.js — 共享响应式状态 + 全部 UI 动作（弹窗 / 设置页共用）
// 说明：popup.html 与 options.html 各自独立挂载 App，模块级单例在各自页面
// 内共享；不跨页面通信（页面间依赖 chrome.storage / Supabase 作为权威）。
import { reactive, computed } from "vue";
import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import {
  getProfile, countServerBookmarks,
  getActiveSpace, switchSpace, createSpace, deleteSpace, renameSpace,
  listDevices, removeDevice, renameDevice, getDeviceId,
  acknowledgeFirstSync, pullOverwriteLocal,
  resetCoordinator,
} from "./sync.js";
import { decryptMoveOp } from "./sync/index.js";
import { exportKey, importKey, hasKey, setKeyFromPassphrase, isFirstDevice, clearLocalKey, ensureLocalKey } from "./crypto.js";
import { t } from "./lib/i18n.js";

// ---- 常量 ----
export const AUTO_SYNC_KEY = "crdt.autoSync";

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
  // lastSyncStatus 为机器可读："ok" | "error"（旧版本为中文文案，展示层兼容）；
  // lastSyncStatusDetail 存原因码 + 错误信息，lastSyncSummary 存方向摘要 JSON，
  // 两者都在展示时才经 t() 本地化（避免持久化文案与浏览器语言不一致）。
  lastSyncStatus: "",
  lastSyncStatusDetail: "",
  lastSyncSummary: "",
  lastDecryptErrors: null,

  // 密钥
  keyValue: "",
  passphraseStored: "",
  keyImportInput: "",
  keyMsg: "",
  keyPhraseInput: "",
  hasKeyNow: false,
  keyStateLoaded: false,

  // 口令门禁（登录后必须先过这关才能进主界面）
  phraseGateVisible: false,
  phraseGateMode: "", // 'setup' = 第一台设备设新口令；'verify' = 其它设备验证旧口令
  phraseGateInput: "",
  phraseGateMsg: "",
  phraseGateBusy: false,
  // 口令门禁是否已判定（key 状态 + setup/verify 模式）。判定完成前主界面不渲染，
  // 避免「先闪现主界面、再弹门禁页」的错误顺序。
  gateChecked: false,

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
  renamingDeviceId: "",
  deviceRenameInput: "",

  // 危险操作两步确认（armed 目标 key + 3 秒递减倒计时）
  armed: "",
  armedLeft: 3,

  // 首同步决策
  showFirstSyncModal: false,
  firstSyncInfo: null, // { localCount, remoteCount, localOnlyCount, remoteEncrypted, hasTombstones, spaceId }
  overwriteArmed: false,
  overwriteLeft: 3,
  firstSyncKeyInput: "",
  firstSyncPhraseInput: "",
  firstSyncKeyMsg: "",

  // 弹窗二级面板（抽屉）
  drawer: "", // '' | 'spaces' | 'key' | 'advanced' | 'help'

  // 设置页导航
  navPane: "account", // 'account' | 'sync' | 'spaces' | 'crypto' | 'advanced' | 'help'

  // 自动同步开关
  autoSync: true,

  // 共存与存储（GC）
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
  state.keyMsg = has ? "" : t("key_noneYet");
  state.keyValue = has ? await exportKey() : "";
  state.passphraseStored = has ? (await api.storage.local.get("crdt.passphrase"))["crdt.passphrase"] || "" : "";
  state.hasKeyNow = has;
  state.keyStateLoaded = true;
}

export async function copyKey() {
  if (!state.keyValue) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(state.keyValue);
  } catch { /* 剪贴板受限时静默 */ }
  state.keyMsg = t("key_copiedMsg");
  showToast("info", t("key_copiedTitle"), t("key_copiedSub"));
}

export async function copyPhrase() {
  if (!state.passphraseStored) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(state.passphraseStored);
  } catch { /* 剪贴板受限时静默 */ }
  showToast("info", t("phrase_copiedTitle"), t("phrase_copiedSub"));
}

export async function doImportKey() {
  const ok = await importKey(state.keyImportInput);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.keyMsg = t("key_importedMsg");
    state.keyImportInput = "";
    state.keyValue = await exportKey();
    state.hasKeyNow = true;
    showToast("success", t("key_importedTitle"), t("key_importedSub"));
  } else {
    state.keyMsg = t("key_badFormat");
    showToast("danger", t("key_badFormatTitle"), t("key_badFormatSub"));
  }
}

export async function doSetKeyByPhrase() {
  const phrase = state.keyPhraseInput;
  if (!phrase || phrase.length < 8) {
    state.keyMsg = t("phrase_tooShort");
    showToast("danger", t("phrase_tooShortTitle"), t("phrase_tooShortSub"));
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    state.keyMsg = t("phrase_setByKeyMsg");
    state.keyPhraseInput = "";
    state.keyValue = await exportKey();
    state.hasKeyNow = true;
    showToast("success", t("phrase_setByKeyTitle"), t("phrase_setByKeySub"));
  } else {
    state.keyMsg = t("phrase_setFail");
    showToast("danger", t("phrase_lenTitle"), t("phrase_notSet"));
  }
}

// ---- 口令门禁：登录后必须先过这关才能进主界面 ----
// 第一台设备（云端无盐）：设置新口令；其它设备（云端有盐）：输入旧口令，
// 用它拉云端一条 op 解密，失败即口令错。口令一旦设过就不可再改。
export async function initPhraseGate() {
  const has = await hasKey();
  if (has) {
    state.phraseGateVisible = false;
    return;
  }
  state.phraseGateMode = (await isFirstDevice()) ? "setup" : "verify";
  state.phraseGateInput = "";
  state.phraseGateMsg = "";
  state.phraseGateBusy = false;
  state.phraseGateVisible = true;
}

export async function submitPhraseGate() {
  const phrase = state.phraseGateInput;
  if (!phrase || phrase.length < 8) {
    state.phraseGateMsg = t("gate_errShort");
    return;
  }
  state.phraseGateBusy = true;
  state.phraseGateMsg = "";
  try {
    const ok = await setKeyFromPassphrase(phrase);
    if (!ok) {
      state.phraseGateMsg = t("gate_errSetFail");
      return;
    }
    // verify 模式：云端已有数据，必须能解密一条真实 op 才算口令正确。
    if (state.phraseGateMode === "verify") {
      let verified = false;
      try {
        const { active } = await getActiveSpace();
        if (active) {
          const { data } = await supabase
            .from("bsync_op_log")
            .select("op")
            .eq("space_id", active.id)
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (data?.op) {
            // 用刚存的密钥解一条 op；解密抛错即口令错
            const kmKey = await ensureLocalKey();
            await decryptMoveOp(data.op, kmKey, active.id);
            verified = true;
          } else {
            // 云端还没有 op（刚设过口令还没播种）：无数据可验，先放行
            verified = true;
          }
        } else {
          verified = true; // 还没空间，放行让流程自己建
        }
      } catch {
        verified = false;
      }
      if (!verified) {
        await clearLocalKey();
        state.phraseGateMsg = t("gate_errWrong");
        return;
      }
    }
    // 通过：在本机存一份口令明文（不上云），供加密面板查看/备份
    await api.storage.local.set({ "crdt.passphrase": phrase });
    // 通过：关门禁，重置 coordinator 让 SW 用新密钥
    state.phraseGateVisible = false;
    state.phraseGateInput = "";
    resetCoordinator();
    api.runtime.sendMessage({ type: "bsync-reset-coordinator" });
    await Promise.all([refreshStatus(), refreshProfile(), refreshSpacesDevices(), refreshKeyState()]);
    showToast("success",
      state.phraseGateMode === "setup" ? t("gate_okSetupTitle") : t("gate_okVerifyTitle"),
      state.phraseGateMode === "setup" ? t("gate_okSetupSub") : t("gate_okVerifySub"));
    // 立即同步：清掉设口令前遗留的 no_key 失败状态，也省一次手动点击。
    // 若双方都有书签，syncNow 会按流程弹出首同步决策弹窗。
    syncNow();
  } finally {
    state.phraseGateBusy = false;
  }
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
  showToast("info", t("spaces_switchedTitle", sp.name), t("spaces_switchedSub"));
}

export async function doCreateSpace() {
  if (!state.newSpaceName.trim() || state.spaceBusy) return;
  state.spaceBusy = true;
  try {
    const r = await createSpace(state.newSpaceName);
    if (!r.ok && r.reason === "plan_locked") {
      state.showUpgradeModal = true;
      showToast("warning", t("spaces_limitTitle"), t("spaces_limitSub"));
      return;
    }
    if (!r.ok && r.reason === "duplicate") {
      showToast("danger", t("spaces_dupTitle"), "");
      return;
    }
    if (!r.ok) {
      showToast("danger", t("common_failPrefix", r.error ?? r.reason), "");
      return;
    }
    state.newSpaceName = "";
    state.creatingSpace = false;
    await refreshSpacesDevices();
    showToast("success", t("spaces_createdTitle"), t("spaces_createdSub"));
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
  if (!r.ok && r.reason === "duplicate") {
    showToast("danger", t("spaces_dupTitle"), "");
    return;
  }
  if (!r.ok) {
    showToast("danger", t("spaces_renameFail", r.error ?? r.reason), "");
    return;
  }
  await refreshSpacesDevices();
  showToast("success", t("spaces_renamed"), "");
}

export async function doDeleteSpace(sp) {
  armAction(`space:${sp.id}`, async () => {
    const r = await deleteSpace(sp.id);
    if (!r.ok && r.reason === "cannot_delete_default") {
      showToast("danger", t("spaces_cantDeleteDefault"), "");
      return;
    }
    if (!r.ok) {
      showToast("danger", t("spaces_deleteFail", r.error ?? r.reason), "");
      return;
    }
    await refreshSpacesDevices();
    showToast("success", t("spaces_deletedTitle", sp.name), "");
  });
}

export async function doRemoveDevice(d) {
  armAction(`device:${d.device_id}`, async () => {
    try {
      await removeDevice(d.device_id);
      await refreshSpacesDevices();
      showToast("success", t("devices_removedTitle"), t("devices_removedSub"));
    } catch (e) {
      showToast("danger", t("common_failPrefix", e?.message ?? e), "");
    }
  });
}

// ---- 设备改名 ----
export function startDeviceRename(d) {
  state.renamingDeviceId = d.device_id;
  state.deviceRenameInput = baseDeviceName(d); // 预填当前存储名；未命名过则为空
}

export async function submitDeviceRename(d) {
  const name = state.deviceRenameInput.trim();
  if (!name || name === baseDeviceName(d)) {
    state.renamingDeviceId = "";
    return;
  }
  const r = await renameDevice(d.device_id, name);
  state.renamingDeviceId = "";
  if (!r.ok && r.reason === "invalid_name") {
    showToast("danger", t("devices_invalidName"), t("devices_invalidNameSub"));
    return;
  }
  if (!r.ok) {
    showToast("danger", t("devices_renameFail", r.error ?? r.reason), "");
    return;
  }
  await refreshSpacesDevices();
  showToast("success", t("devices_renamed"), t("devices_renamedSub"));
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
    const n = baseDeviceName(d) || t("device_unknown", shortTag(d.device_id));
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
});

export function deviceLabel(d) {
  const known = baseDeviceName(d);
  const name = known || t("device_unknown", shortTag(d.device_id));
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
      showToast("danger", t("pay_checkoutFail"), data?.message ?? error?.message ?? t("pay_tryLater"));
      return;
    }
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
    state.showUpgradeModal = false;
    showToast("info", t("pay_checkoutOpened"), t("pay_checkoutOpenedSub"));
  } catch (e) {
    showToast("danger", t("pay_checkoutFail"), e?.message ?? e);
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
      showToast("danger", t("pay_portalFail"), data?.message ?? error?.message ?? t("pay_tryLater"));
      return;
    }
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  } catch (e) {
    showToast("danger", t("pay_portalFail"), e?.message ?? e);
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
        lastSyncStatus: "ok",
        lastSyncStatusDetail: "",
        lastSyncSummary: JSON.stringify({ overwritten: true }),
      });
      await refreshStatus();
      showToast("success", t("common_done"), t("status_overwritten"));
      await refreshProfile();
      await refreshSpacesDevices();
    } else if (r.reason === "decrypt_error") {
      showToast("danger", t("toast_decryptTitle"), r.error ?? t("toast_checkKey"));
    } else if (r.reason === "quota_exceeded") {
      state.showUpgradeModal = true;
      showToast("warning", t("toast_quotaTitle"), t("toast_quotaSub"));
    } else {
      showToast("danger", t("spaces_overwriteFail", r.error ?? r.reason), "");
    }
  } catch (e) {
    showToast("danger", t("common_failPrefix", e?.message ?? e), "");
  } finally {
    state.syncBusy = false;
  }
}

export function dismissFirstSync() {
  state.showFirstSyncModal = false;
  showToast("info", t("fs_dismissedTitle"), t("fs_dismissedSub"));
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
    state.firstSyncKeyMsg = t("key_badFormat");
  }
}

export async function phraseFirstSyncKey() {
  const phrase = state.firstSyncPhraseInput;
  if (!phrase || phrase.length < 8) {
    state.firstSyncKeyMsg = t("phrase_tooShort");
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
    state.firstSyncKeyMsg = t("phrase_setFail");
  }
}

// ---- 同步 ----
export async function refreshStatus(extra) {
  const s = await api.storage.local.get(["lastSyncAt", "lastSyncStatus", "lastSyncStatusDetail", "lastSyncSummary", "lastDecryptErrors"]);
  state.lastSyncAt = s.lastSyncAt ?? null;
  state.lastSyncStatus = s.lastSyncStatus ?? "";
  state.lastSyncStatusDetail = s.lastSyncStatusDetail ?? "";
  state.lastSyncSummary = s.lastSyncSummary ?? "";
  state.lastDecryptErrors = s.lastDecryptErrors ?? null;
  if (extra) showToast("info", extra);
}

// 把 runSync 返回的 {pushed, pulled, seeded, restored, decryptFailed} 压成可持久化的摘要。
// 注意：pushed/pulled 是 CRDT 操作行数（一个书签的建/移/改会产 2~3 条 op，
// 冷启动重放还会把历史 op 全计一遍），和「书签数」不是一回事，直接展示会让用户
// 误以为传了 N 个书签。持久层只存方向码，展示层（summaryText）再本地化。
function summarize(r) {
  return {
    seeded: !!r.seeded,
    restored: !!r.restored,
    push: (r.pushed || 0) > 0,
    pull: (r.pulled || 0) > 0,
    dec: r.decryptFailed || 0,
  };
}

function summaryText(sum) {
  if (!sum) return "";
  let body;
  if (sum.seeded) body = t("status_seeded");
  else if (sum.restored) body = t("status_restored");
  else if (sum.push && sum.pull) body = t("status_bidirectional");
  else if (sum.push) body = t("status_pushed");
  else if (sum.pull) body = t("status_pulled");
  else body = t("status_uptodate");
  return sum.dec > 0 ? body + ` · ${t("status_decryptWarn", sum.dec)}` : body;
}

function parseSummary(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// 原因码 → 用户可读文案（未知原因原样展示）
export function reasonText(reason) {
  switch (reason) {
    case "not_authenticated": return t("err_notAuthenticated");
    case "no_space": return t("err_noSpace");
    case "no_key": return t("err_noKey");
    case "timeout":
    case "no_response": return t("err_timeout");
    case "rate_limited": return t("err_rateLimited");
    case "quota_exceeded": return t("err_quota");
    case "device_limit_reached": return t("err_deviceLimit");
    case "decrypt_error": return t("err_decrypt");
    case "replica_incomplete": return t("err_replicaIncomplete");
    default: return reason ?? "";
  }
}

// 原因 + 错误详情合并展示；error 与原因文案相同（引擎会对已知原因附带同一句
// 本地化文案）时不重复括号，避免「请先设置同步口令 (请先设置同步口令)」。
export function reasonDisplay(reason, error) {
  const base = reasonText(reason);
  return error && error !== base ? `${base} (${error})` : base;
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
      setTimeout(() => resolve({ ok: false, reason: "timeout", error: t("err_timeout") }), 60000)
    );
    const r = await Promise.race([msgResult, timeout]);
    if (!r.ok && r.reason === "first_sync_confirm_needed") {
      // 本设备第一次与该空间同步且需要决策（双方都有书签 / 云端密文待导密钥）
      state.firstSyncInfo = r;
      state.overwriteArmed = false;
      state.firstSyncKeyMsg = "";
      state.showFirstSyncModal = true;
      showToast("info", r.remoteEncrypted ? t("toast_fsEncrypted") : t("toast_fsBoth"), "");
      return;
    }
    if (!r.ok && r.reason === "no_key") {
      // 本机还没有同步口令：打开口令门禁页（唯一入口，不设置无法使用插件）。
      // 门禁页本身就是提示，不再叠加 toast。
      await initPhraseGate();
      return;
    }
    if (!r.ok && r.reason === "quota_exceeded") {
      // 字节配额撞顶（0032 服务端执行）。已付费/试用 Pro：给出清理指引而非升级弹窗；
      // Free/Plus：升级引导。
      if (planLabel.value === "Pro") {
        showToast("warning", t("toast_proByteLimitTitle"), t("toast_proByteLimitSub"));
      } else {
        state.showUpgradeModal = true;
        showToast("warning", t("toast_quotaTitle"), t("toast_quotaSub"));
      }
      return;
    }
    if (!r.ok && r.reason === "device_limit_reached") {
      // 设备数超计划上限（0033）：升级引导 + 提示可移除旧设备腾位
      state.showUpgradeModal = true;
      showToast("warning", t("toast_deviceLimitTitle"), t("toast_deviceLimitSub"));
      return;
    }
    if (!r.ok && r.reason === "rate_limited") {
      // 限流（0032）：正常客户端几乎不会触发，静默提示即可，下轮自动重试
      showToast("info", t("toast_rateTitle"), t("toast_rateSub"));
      return;
    }
    if (!r.ok && r.reason === "decrypt_error") {
      // 端到端加密：密钥不匹配 / 数据损坏，引导用户导入密钥
      showToast("danger", t("toast_decryptTitle"), r.error ?? t("toast_checkKey"));
      return;
    }
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: r.ok ? "ok" : "error",
      lastSyncStatusDetail: r.ok ? "" : `${r.reason ?? ""}${r.error ? ` (${r.error})` : ""}`,
      lastSyncSummary: r.ok ? JSON.stringify(summarize(r)) : "",
    });
    await refreshStatus();
    if (r.ok) {
      showToast("success", t("toast_syncDone"), summaryText(parseSummary(state.lastSyncSummary)));
    } else {
      showToast("danger", reasonDisplay(r.reason, r.error), "");
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
    showToast("danger", t("common_failPrefix", e?.message ?? e), "");
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
    state.autoSync ? t("autosync_onTitle") : t("autosync_offTitle"),
    state.autoSync ? t("autosync_onSub") : t("autosync_offSub")
  );
}

// ---- 共存与存储（GC 由服务端托管，客户端仅展示最近一次压缩时间） ----
export async function loadCoexistPanel() {
  const s = await api.storage.local.get(["lastGcAt"]);
  state.lastGcAt = s["lastGcAt"] ?? null;
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
      state.authError = t("auth_errRequired");
      return;
    }
    let res;
    if (state.mode === "register") {
      res = await supabase.auth.signUp({ email: em, password: pw });
      if (res.error) {
        state.authError = t("auth_errRegister", res.error.message);
        return;
      }
      if (!res.data.session) {
        state.session = null;
        state.authSuccess = t("auth_successRegister");
        return;
      }
    } else {
      res = await supabase.auth.signInWithPassword({ email: em, password: pw });
      if (res.error) {
        state.authError = t("auth_errLogin", res.error.message);
        return;
      }
    }
    state.session = res.data.session;
    // 刚登录：主界面等口令门禁判定完成后再渲染（防止先闪现主界面）
    state.gateChecked = false;
    // 记住邮箱，方便下次登录（密码不落盘）
    await api.storage.local.set({ rememberEmail: em });
    await refreshStatus();
    await refreshProfile();
    // 登录后立刻判定门禁：无口令 → 立即显示门禁页；有口令 → 直接进主界面
    await initPhraseGate();
    state.gateChecked = true;
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
  state.status = t("toast_loggedOut");
  showToast("info", t("toast_loggedOut"), "");
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
  // 帮助已整合进插件弹窗抽屉；登录页（未登录态）打开官网文档
  const url = "https://www.bookmark-sync.top/docs";
  if (api.tabs?.create) {
    api.tabs.create({ url });
  } else {
    window.open(url, "_blank");
  }
}

// ---- 初始化（App onMounted 调用） ----
export async function init(popup) {
  if (popup) document.body.classList.add("popup");
  // 记住上次登录的邮箱（只存邮箱，不存密码），退出登录后自动填充
  const { rememberEmail } = await api.storage.local.get("rememberEmail");
  if (rememberEmail) state.email = rememberEmail;
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) {
    // 口令门禁判定与资料刷新并行；判定完成（gateChecked=true）前 App.vue
    // 不渲染主界面，保证「登录 → 门禁 → 主界面」顺序，不会先闪现主界面。
    await Promise.all([
      Promise.all([refreshStatus(), refreshProfile(), refreshSpacesDevices(), loadAutoSync(), loadCoexistPanel(), refreshKeyState()]),
      initPhraseGate(),
    ]);
    state.gateChecked = true;
  }
  supabase.auth.onAuthStateChange(async (_e, s) => {
    const prev = state.session;
    state.session = s;
    if (s) {
      // 刚登录（prev 为空）：主界面等门禁判定完成后再渲染；
      // TOKEN_REFRESHED 等事件（prev 非空）不重置，避免已渲染界面闪烁。
      if (!prev) state.gateChecked = false;
      await Promise.all([
        Promise.all([refreshStatus(), refreshProfile(), refreshSpacesDevices(), loadAutoSync(), loadCoexistPanel(), refreshKeyState()]),
        initPhraseGate(),
      ]);
      state.gateChecked = true;
    } else {
      state.profile = null;
      state.serverCount = null;
      state.spaces = [];
      state.devices = [];
      state.activeSpace = null;
      state.drawer = "";
    }
  });

  // SW 自动同步（事件桥 flushSoon / 定时拉取）跑完后会发 bsync-sync-done，
  // 开着的 popup/options 收到后刷新书签数、最后同步状态——否则自动同步在后台
  // 跑完了，UI 里还停留在打开时的旧值。
  api.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "bsync-sync-done") {
      refreshStatus();
      refreshProfile();
      refreshSpacesDevices();
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
  if (p === "pro" || p === "lifetime") return null; // 不限数量（字节口径兜底）
  return p === "plus" || p === "premium" ? 10000 : 500;
});

// Pro/Lifetime 按字节口径预警：E2EE 下服务端以字节执行（0032），
// 对外仍是「数量不限」，撞顶前按 used_bytes/quota_bytes 提醒。
// used_bytes 由服务端在推送/GC 后回写（0032），老账号下次推送前可能还是 0。
export const byteUsagePct = computed(() => {
  const p = state.profile;
  if (!p) return 0;
  if (!(p.plan === "pro" || p.plan === "lifetime")) return 0;
  if (!p.quota_bytes || p.used_bytes == null) return 0;
  return Math.min(100, Math.round((p.used_bytes / p.quota_bytes) * 100));
});

export const proByteLabel = computed(() => {
  const p = state.profile;
  if (!p?.quota_bytes || p.used_bytes == null) return "";
  if (!(p.plan === "pro" || p.plan === "lifetime")) return "";
  const mb = (b) => (b / 1024 / 1024).toFixed(1).replace(/\.0$/, "");
  return t("quota_proBytes", mb(p.used_bytes), mb(p.quota_bytes));
});

export const usagePct = computed(() => {
  if (byteUsagePct.value > 0) return byteUsagePct.value;
  if (!quotaCount.value || usedCount.value == null) return 0;
  return Math.min(100, Math.round((usedCount.value / quotaCount.value) * 100));
});

export const quotaState = computed(() => {
  // Pro 字节口径：≥80% 提醒、≥100% 阻断（约 25 万条封顶）
  if (byteUsagePct.value >= 100) return "over";
  if (byteUsagePct.value >= 80) return "warn";
  if (usedCount.value == null || !quotaCount.value) return "ok";
  const pct = (usedCount.value / quotaCount.value) * 100;
  if (pct >= 100) return "over";
  if (pct >= 90) return "warn";
  return "ok";
});

export const quotaBadge = computed(() => {
  if (quotaState.value === "over") return { text: t("quota_over"), cls: "badge-danger" };
  if (quotaState.value === "warn") return { text: t("quota_warn"), cls: "badge-warning" };
  return { text: planLabel.value.toUpperCase(), cls: "badge-neutral" };
});

export const quotaFoot = computed(() => {
  const spaceName = state.activeSpace?.name ?? "";
  let remain;
  if (quotaState.value === "over") {
    if (byteUsagePct.value >= 100) return t("quota_footOverBytes");
    return t("quota_footOver", ((usedCount.value ?? 0) - quotaCount.value).toLocaleString());
  }
  if (quotaState.value === "warn") {
    if (byteUsagePct.value >= 80 && proByteLabel.value) return t("quota_footWarnBytes", proByteLabel.value);
    return t("quota_footWarn", (quotaCount.value - usedCount.value).toLocaleString());
  }
  remain = quotaCount.value
    ? t("quota_remain", (quotaCount.value - usedCount.value).toLocaleString())
    : (proByteLabel.value ? t("quota_unlimitedBytes", proByteLabel.value) : t("quota_unlimitedFoot"));
  return spaceName ? t("quota_footSpace", spaceName, remain) : remain;
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
  // 新格式 "error"；兼容旧版本持久化的中文前缀文案
  if (st === "error" || st.startsWith("未同步") || st.startsWith("失败")) return "error";
  return "ok";
});

export const syncTitle = computed(() => {
  switch (syncState.value) {
    case "syncing": return t("status_syncing");
    case "never": return t("status_never");
    case "error": return t("status_error");
    default: return t("status_ok");
  }
});

export const syncSub = computed(() => {
  const st = state.lastSyncStatus ?? "";
  if (syncState.value === "syncing") return t("status_syncingSub");
  if (syncState.value === "never") return t("status_neverSub");
  if (syncState.value === "error") {
    // 新格式：lastSyncStatusDetail = "原因码 (错误信息)"；旧格式：中文「未同步:/失败:」前缀
    const raw = (state.lastSyncStatusDetail || st.replace(/^error:/, "")).replace(/^(未同步|失败):\s*/, "");
    const m = raw.match(/^([a-z_]+)\s*(?:\((.*)\))?\s*$/);
    if (m && m[1]) {
      const shown = reasonDisplay(m[1], m[2]);
      if (shown) return shown;
    }
    return raw || t("err_network");
  }
  const decrypt = state.lastDecryptErrors?.errors?.length;
  if (decrypt) return t("status_decryptLine", decrypt);
  const sum = parseSummary(state.lastSyncSummary);
  if (sum) return summaryText(sum);
  // 兼容旧版本持久化的中文摘要文案
  if (st && st !== "ok") return st;
  return t("status_okSub", usedCount.value ?? 0);
});

export const syncTail = computed(() => {
  if (syncState.value === "never") return t("status_unregistered");
  return fmtRelative(state.lastSyncAt);
});

export function fmtRelative(ts) {
  if (!ts) return t("time_never");
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("time_now");
  if (m < 60) return t("time_min", m);
  const h = Math.floor(m / 60);
  if (h < 24) return t("time_hour", h);
  const d = Math.floor(h / 24);
  if (d < 30) return t("time_day", d);
  return fmt(ts);
}

export function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : t("time_never");
}

// 空间数量档位：Free 1 · Plus 3 · Pro/Lifetime 10
export const spaceLimit = computed(() => {
  const p = state.profile?.plan;
  if (p === "pro" || p === "lifetime") return 10;
  if (p === "plus" || p === "premium") return 3;
  return 1;
});
