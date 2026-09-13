<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import {
  runSync, getProfile, countServerBookmarks,
  getActiveSpace, switchSpace, createSpace, deleteSpace, renameSpace,
  listDevices, removeDevice, getDeviceId,
  acknowledgeFirstSync, pullOverwriteLocal,
} from "./sync.js";
import { exportKey, importKey, hasKey, setKeyFromPassphrase, getEncryptMode, setEncryptMode } from "./crypto.js";

const props = defineProps({ popup: { type: Boolean, default: false } });

const session = ref(null);
const email = ref("");
const password = ref("");
const mode = ref("login"); // 'login' | 'register'
const busy = ref(false);
const syncBusy = ref(false);
const status = ref("");

// 同步密钥（E2EE）管理：换设备时导出并在新设备导入同一密钥
const keyValue = ref("");
const keyImportInput = ref("");
const keyMsg = ref("");
const keyPhraseInput = ref("");
const encryptMode = ref("plain");

// 付费档案 + 升级 modal
const profile = ref(null); // { plan, quota_bytes, used_bytes, used_count?, purchased_at }
const serverCount = ref(null); // 基线回退：最近一次同步后的服务端书签条数
const showUpgradeModal = ref(false);
const checkoutBusy = ref(false);

// 同步空间 + 设备管理（设备名由插件自动检测，无需手动命名）
const spaces = ref([]);
const activeSpace = ref(null);
const devices = ref([]);
const myDeviceId = ref("");
const newSpaceName = ref("");
const spaceBusy = ref(false);

// 工具面板：tab 切换，一次只开一个（'' = 全部收起）
const activePanel = ref("");

function togglePanel(name) {
  activePanel.value = activePanel.value === name ? "" : name;
  if (activePanel.value === "spaceDevice") refreshSpacesDevices();
  if (activePanel.value === "key") loadKeyPanel();
}

// 空间行内改名
const renamingId = ref("");
const renameInput = ref("");

// 危险操作两步确认（popup 不能用 window.confirm）：首次点击进入确认态，3 秒内再点执行
const armed = ref("");

// 首同步决策 modal（本设备第一次与某空间同步且双方都有书签：合并 / 云端覆盖本机 / 暂不同步）
const showFirstSyncModal = ref(false);
const firstSyncInfo = ref(null); // { localCount, remoteCount, localOnlyCount, remoteEncrypted, hasTombstones, spaceId }
const overwriteArmed = ref(false);
// 首同步 + 云端密文时的密钥导入（导入成功后重新检测，回到四象限决策）
const firstSyncKeyInput = ref("");
const firstSyncPhraseInput = ref("");
const firstSyncKeyMsg = ref("");

async function refreshSpacesDevices() {
  try {
    const { spaces: sp, active } = await getActiveSpace();
    spaces.value = sp;
    activeSpace.value = active;
    devices.value = await listDevices();
    myDeviceId.value = await getDeviceId();
  } catch (e) {
    console.warn("[app] refreshSpacesDevices failed:", e?.message ?? e);
  }
}

async function loadKeyPanel() {
  encryptMode.value = await getEncryptMode();
  keyMsg.value = (await hasKey()) ? "" : "本设备尚无密钥，首次同步时会按下方设置自动生成。";
  try {
    keyValue.value = await exportKey();
  } catch {
    keyValue.value = "";
  }
}

async function doSwitchSpace(sp) {
  if (sp.id === activeSpace.value?.id) return;
  await switchSpace(sp.id);
  await refreshSpacesDevices();
  refreshStatus(
    `已切换到空间「${sp.name}」。下次同步将与该空间的数据按并集合并（本设备书签会并入该空间）。`
  );
}

async function doCreateSpace() {
  if (!newSpaceName.value.trim() || spaceBusy.value) return;
  spaceBusy.value = true;
  try {
    const r = await createSpace(newSpaceName.value);
    if (!r.ok && r.reason === "plan_locked") {
      showUpgradeModal.value = true;
      refreshStatus("空间数量已达当前档位上限，升级可获得更多空间");
      return;
    }
    if (!r.ok && r.reason === "duplicate") {
      refreshStatus("已存在同名空间");
      return;
    }
    if (!r.ok) {
      refreshStatus(`创建失败: ${r.error ?? r.reason}`);
      return;
    }
    newSpaceName.value = "";
    await refreshSpacesDevices();
    refreshStatus("空间已创建，点击空间名即可切换");
  } finally {
    spaceBusy.value = false;
  }
}

function startRename(sp) {
  renamingId.value = sp.id;
  renameInput.value = sp.name;
}

async function submitRename(sp) {
  const name = renameInput.value.trim();
  if (!name || name === sp.name) {
    renamingId.value = "";
    return;
  }
  const r = await renameSpace(sp.id, name);
  renamingId.value = "";
  if (!r.ok) {
    refreshStatus(`重命名失败: ${r.error ?? r.reason}`);
    return;
  }
  await refreshSpacesDevices();
}

async function doDeleteSpace(sp) {
  const key = `space:${sp.id}`;
  if (armed.value !== key) {
    armed.value = key;
    setTimeout(() => {
      if (armed.value === key) armed.value = "";
    }, 3000);
    return;
  }
  armed.value = "";
  const r = await deleteSpace(sp.id);
  if (!r.ok && r.reason === "cannot_delete_default") {
    refreshStatus("默认空间不可删除");
    return;
  }
  if (!r.ok) {
    refreshStatus(`删除失败: ${r.error ?? r.reason}`);
    return;
  }
  await refreshSpacesDevices();
  refreshStatus(`空间「${sp.name}」已删除`);
}

async function doRemoveDevice(d) {
  const key = `device:${d.device_id}`;
  if (armed.value !== key) {
    armed.value = key;
    setTimeout(() => {
      if (armed.value === key) armed.value = "";
    }, 3000);
    return;
  }
  armed.value = "";
  try {
    await removeDevice(d.device_id);
    await refreshSpacesDevices();
    refreshStatus("已解除该浏览器的同步（其删除记录一并清除）");
  } catch (e) {
    refreshStatus(`移除失败: ${e?.message ?? e}`);
  }
}

// 设备名展示：老设备可能没存名字（服务端回填了原始 UUID），显示短标记而不是裸 ID
function baseDeviceName(d) {
  const raw = d.name || "";
  if (!raw || raw === d.device_id || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return "";
  }
  return raw;
}

// 同名设备（同浏览器同系统）追加短 ID 后缀区分
const dupDeviceNames = computed(() => {
  const m = new Map();
  for (const d of devices.value) {
    const n = baseDeviceName(d) || `未知设备 · ${shortTag(d.device_id)}`;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
});

function shortTag(id) {
  let h = 0;
  const s = String(id ?? "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(4, "0").slice(-4).toUpperCase();
}

function deviceLabel(d) {
  const known = baseDeviceName(d);
  const name = known || `未知设备 · ${shortTag(d.device_id)}`;
  return (dupDeviceNames.value.get(name) ?? 0) > 1 ? `${name} · ${shortTag(d.device_id)}` : name;
}

// 设备最近同步的空间名（用户心智是「哪台浏览器在对哪棵树干活」）
function deviceSpaceName(d) {
  if (!d.last_space_id) return "";
  const sp = spaces.value.find((s) => s.id === d.last_space_id);
  return sp ? sp.name : "";
}

// Creem 订阅：调边缘函数创建收银台会话，支付结果由 creem-webhook 翻转服务端 plan
async function startCheckout(plan) {
  if (checkoutBusy.value) return;
  checkoutBusy.value = true;
  status.value = "正在创建支付会话…";
  try {
    const { data, error } = await supabase.functions.invoke("bsync-creem-checkout", {
      body: { plan },
    });
    const url = data?.checkout_url;
    if (error || !url) {
      status.value = `创建支付会话失败: ${data?.message ?? error?.message ?? "请稍后重试"}`;
      return;
    }
    status.value = "已打开支付页面，完成后回到这里点「立即同步」即可生效";
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
    showUpgradeModal.value = false;
  } catch (e) {
    status.value = `创建支付会话失败: ${e?.message ?? e}`;
  } finally {
    checkoutBusy.value = false;
  }
}

// 管理/取消订阅：打开 Creem 客户门户（门户内点 Cancel Subscription，webhook 同步状态）
async function manageSubscription() {
  status.value = "正在打开订阅管理页…";
  try {
    const { data, error } = await supabase.functions.invoke("bsync-creem-portal", {
      body: {},
    });
    const url = data?.portal_url;
    if (error || !url) {
      status.value = `打开订阅管理失败: ${data?.message ?? error?.message ?? "请稍后重试"}`;
      return;
    }
    status.value = "";
    if (api.tabs?.create) {
      await api.tabs.create({ url });
    } else {
      window.open(url, "_blank");
    }
  } catch (e) {
    status.value = `打开订阅管理失败: ${e?.message ?? e}`;
  }
}

const userEmail = computed(() => session.value?.user?.email ?? "");

const planLabel = computed(() => {
  const p = profile.value?.plan;
  if (p === "pro" || p === "lifetime") return "Pro";
  if (p === "plus" || p === "premium") return "Plus";
  return "Free";
});

// 额度按「条」展示（与定价一致：Free 500 / Plus 10,000 / Pro·Lifetime 不限）。
// 已用条数优先取服务端 used_count（0016 迁移），未部署时回退本地基线统计。
const usedCount = computed(() => {
  if (profile.value && typeof profile.value.used_count === "number") {
    return profile.value.used_count;
  }
  return serverCount.value;
});

const quotaCount = computed(() => {
  const p = profile.value?.plan;
  if (p === "pro" || p === "lifetime") return null; // 不限数量
  return p === "plus" || p === "premium" ? 10000 : 500;
});

const usagePct = computed(() => {
  if (!quotaCount.value || usedCount.value == null) return 0;
  return Math.min(100, Math.round((usedCount.value / quotaCount.value) * 100));
});
const quotaUrgent = computed(() => usagePct.value >= 90);

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : "从未";
}

async function refreshStatus(extra) {
  const s = await api.storage.local.get(["lastSyncAt", "lastSyncStatus"]);
  status.value =
    extra ?? `上次同步: ${fmt(s.lastSyncAt)}${s.lastSyncStatus ? " · " + s.lastSyncStatus : ""}`;
}

async function refreshProfile() {
  profile.value = await getProfile();
  if (!(profile.value && typeof profile.value.used_count === "number")) {
    serverCount.value = await countServerBookmarks();
  }
}

onMounted(async () => {
  if (props.popup) document.body.classList.add("popup");
  const { data } = await supabase.auth.getSession();
  session.value = data.session;
  if (session.value) {
    await refreshStatus();
    await refreshProfile();
    await refreshSpacesDevices();
  }
  supabase.auth.onAuthStateChange(async (_e, s) => {
    session.value = s;
    if (s) {
      await refreshStatus();
      await refreshProfile();
      await refreshSpacesDevices();
    } else {
      profile.value = null;
      serverCount.value = null;
      spaces.value = [];
      devices.value = [];
      activeSpace.value = null;
    }
  });
});

async function submit() {
  busy.value = true;
  try {
    const em = email.value.trim();
    const pw = password.value;
    if (!em || !pw) {
      status.value = "请输入邮箱和密码";
      return;
    }
    let res;
    if (mode.value === "register") {
      res = await supabase.auth.signUp({ email: em, password: pw });
      if (res.error) {
        status.value = `注册失败: ${res.error.message}`;
        return;
      }
      if (!res.data.session) {
        session.value = null;
        status.value = "注册成功，请查收确认邮件后登录";
        return;
      }
    } else {
      res = await supabase.auth.signInWithPassword({ email: em, password: pw });
      if (res.error) {
        status.value = `登录失败: ${res.error.message}`;
        return;
      }
    }
    session.value = res.data.session;
    await refreshStatus();
    await refreshProfile();
  } finally {
    busy.value = false;
  }
}

// ---- 首同步决策（四象限的「确认」分支）----

// 合并（推荐）：写 ack 后强制重入 runSync 走三态合并
async function firstSyncMerge() {
  const spaceId = firstSyncInfo.value?.spaceId;
  showFirstSyncModal.value = false;
  if (spaceId) await acknowledgeFirstSync(spaceId);
  await syncNow({ force: true });
}

// 远程覆盖本地：两步确认（popup 无 window.confirm，复用 armed 模式）
function firstSyncOverwrite() {
  if (!overwriteArmed.value) {
    overwriteArmed.value = true;
    setTimeout(() => {
      if (overwriteArmed.value) overwriteArmed.value = false;
    }, 3000);
    return;
  }
  overwriteArmed.value = false;
  doOverwriteLocal();
}

async function doOverwriteLocal() {
  showFirstSyncModal.value = false;
  syncBusy.value = true;
  refreshStatus("正在用云端书签覆盖本机…");
  try {
    const r = await pullOverwriteLocal();
    if (r.ok) {
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: `已按云端覆盖本机 · 变更 ${r.pulled} 处`,
      });
      refreshStatus(`完成: 已按云端覆盖本机（变更 ${r.pulled} 处）`);
      await refreshProfile();
      await refreshSpacesDevices();
    } else if (r.reason === "decrypt_error") {
      refreshStatus(r.error ?? "云端数据无法解密，请检查同步密钥");
    } else if (r.reason === "quota_exceeded") {
      showUpgradeModal.value = true;
      refreshStatus("空间不足，请升级到 Plus 或 Pro");
    } else {
      refreshStatus(`覆盖失败: ${r.error ?? r.reason}`);
    }
  } catch (e) {
    refreshStatus(`失败: ${e?.message ?? e}`);
  } finally {
    syncBusy.value = false;
  }
}

function dismissFirstSync() {
  showFirstSyncModal.value = false;
  refreshStatus("已暂不同步。下次同步时会再次询问如何处理。");
}

// E2EE 首同步：导入密钥/口令成功后重新检测 —— 若属自动象限则直接无感同步，
// 否则带着解密后的双方条数重新弹决策
async function importFirstSyncKey() {
  const ok = await importKey(firstSyncKeyInput.value);
  if (ok) {
    firstSyncKeyMsg.value = "";
    firstSyncKeyInput.value = "";
    showFirstSyncModal.value = false;
    await syncNow({});
  } else {
    firstSyncKeyMsg.value = "密钥格式不正确，请确认粘贴的是完整的 44 字符密钥。";
  }
}

async function phraseFirstSyncKey() {
  const phrase = firstSyncPhraseInput.value;
  if (!phrase || phrase.length < 8) {
    firstSyncKeyMsg.value = "口令至少 8 位，且要够长/独特才安全。";
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    firstSyncKeyMsg.value = "";
    firstSyncPhraseInput.value = "";
    showFirstSyncModal.value = false;
    await syncNow({});
  } else {
    firstSyncKeyMsg.value = "口令长度不足，未设置。";
  }
}

async function logout() {
  await supabase.auth.signOut();
  session.value = null;
  profile.value = null;
  serverCount.value = null;
  spaces.value = [];
  devices.value = [];
  activeSpace.value = null;
  activePanel.value = "";
  armed.value = "";
  status.value = "已退出登录";
}

async function syncNow(opts = {}) {
  // 注意：模板 @click 直传时 opts 可能是事件对象，统一归一化为 force 布尔
  const force = opts === true || !!opts?.force;
  syncBusy.value = true;
  refreshStatus("同步中…");
  try {
    const r = await runSync({ force });
    if (!r.ok && r.reason === "first_sync_confirm_needed") {
      // 本设备第一次与该空间同步且需要决策（双方都有书签 / 云端密文待导密钥）
      firstSyncInfo.value = r;
      overwriteArmed.value = false;
      firstSyncKeyMsg.value = "";
      showFirstSyncModal.value = true;
      refreshStatus(
        r.remoteEncrypted
          ? "云端数据已加密，请先导入同步密钥或口令"
          : "本机与云端都有书签，请确认如何同步"
      );
      return;
    }
    if (!r.ok && r.reason === "quota_exceeded") {
      // 空间不足，弹升级 modal
      showUpgradeModal.value = true;
      refreshStatus("空间不足，请升级到 Plus 或 Pro");
      return;
    }
    if (!r.ok && r.reason === "decrypt_error") {
      // 端到端加密：密钥不匹配 / 数据损坏，引导用户导入密钥
      refreshStatus(r.error ?? "数据无法解密，请检查同步密钥");
      return;
    }
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: r.ok
        ? `推送 ${r.pushed} · 拉取 ${r.pulled}`
        : `${r.reason}${r.error ? ` (${r.error})` : ""}`,
    });
    refreshStatus(
      r.ok ? `完成: 推送 ${r.pushed} · 拉取 ${r.pulled}` : `${r.reason}${r.error ? ` (${r.error})` : ""}`
    );
    // 同步后刷新配额与空间/设备状态（push 会登记本设备）
    if (r.ok) {
      await refreshProfile();
      await refreshSpacesDevices();
    }
  } catch (e) {
    refreshStatus(`失败: ${e?.message ?? e}`);
  } finally {
    syncBusy.value = false;
  }
}

function openUpgrade() {
  showUpgradeModal.value = true;
}

async function changeEncryptMode(mode) {
  encryptMode.value = mode;
  await setEncryptMode(mode);
  if (mode === "e2ee") {
    keyValue.value = await exportKey();
    keyMsg.value = "已启用端到端加密。新装设备需导入密钥或输入同一口令才能解密。";
  } else {
    keyMsg.value = "已切换为明文模式（服务器可读内容）。若该账号已有加密数据，请勿在此开启明文，否则会解密失败。";
  }
}

async function copyKey() {
  if (!keyValue.value) return;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(keyValue.value);
  } catch {}
  keyMsg.value = "密钥已复制，请妥善保管（丢失后无法解密既有数据）。";
}

async function doImportKey() {
  const ok = await importKey(keyImportInput.value);
  if (ok) {
    keyMsg.value = "密钥已导入。同步时即可解密换设备同步来的书签。";
    keyImportInput.value = "";
    keyValue.value = await exportKey();
  } else {
    keyMsg.value = "密钥格式不正确，请确认粘贴的是完整的 44 字符密钥。";
  }
}

async function doSetKeyByPhrase() {
  const phrase = keyPhraseInput.value;
  if (!phrase || phrase.length < 8) {
    keyMsg.value = "口令至少 8 位，且要够长/独特才安全。";
    return;
  }
  const ok = await setKeyFromPassphrase(phrase);
  if (ok) {
    keyMsg.value = "已用口令设定密钥。新装一台设备时，输入同一口令即可解密同步数据。";
    keyPhraseInput.value = "";
    keyValue.value = "";
    keyValue.value = await exportKey();
  } else {
    keyMsg.value = "口令长度不足，未设置。";
  }
}
</script>

<template>
  <!-- 未登录：登录 / 注册 -->
  <div v-if="!session" class="auth">
    <div class="brand">
      <div class="logo logo-lg">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 3h12a1 1 0 0 1 1 1v16.6a.4.4 0 0 1-.62.33L12 16.8l-6.38 4.13A.4.4 0 0 1 5 20.6V4a1 1 0 0 1 1-1Z" />
        </svg>
      </div>
      <h1>Bookmark Sync</h1>
      <p class="sub">在浏览器间安全同步你的书签</p>
    </div>

    <div class="seg" role="tablist">
      <button type="button" :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
      <button type="button" :class="{ on: mode === 'register' }" @click="mode = 'register'">注册</button>
    </div>

    <input
      id="email"
      v-model="email"
      class="input"
      type="email"
      placeholder="邮箱地址"
      autocomplete="email"
      aria-label="邮箱"
    />
    <input
      id="password"
      v-model="password"
      class="input"
      type="password"
      :placeholder="mode === 'login' ? '密码' : '密码（至少 6 位）'"
      autocomplete="current-password"
      aria-label="密码"
      @keyup.enter="submit"
    />

    <button id="authSubmit" class="btn-primary btn-block" :disabled="busy" @click="submit">
      {{ mode === "login" ? "登录" : "创建账号" }}
    </button>

    <div class="status">{{ status }}</div>
  </div>

  <!-- 已登录 -->
  <div v-else>
    <header class="head">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 3h12a1 1 0 0 1 1 1v16.6a.4.4 0 0 1-.62.33L12 16.8l-6.38 4.13A.4.4 0 0 1 5 20.6V4a1 1 0 0 1 1-1Z" />
        </svg>
      </div>
      <div class="head-main">
        <h1>Bookmark Sync</h1>
        <p id="userEmail" class="email" :title="userEmail">{{ userEmail }}</p>
      </div>
      <button id="logout" class="link" @click="logout">退出</button>
    </header>

    <!-- 配额（按条展示，与定价口径一致） -->
    <section class="quota">
      <div class="quota-top">
        <span class="plan-tag" :class="profile?.plan ?? 'free'">{{ planLabel }}</span>
        <span id="quotaText" class="quota-num">
          <template v-if="usedCount == null">额度加载中…</template>
          <template v-else-if="quotaCount">
            {{ usedCount.toLocaleString() }} / {{ quotaCount.toLocaleString() }} 条
          </template>
          <template v-else>{{ usedCount.toLocaleString() }} 条 · 不限数量</template>
        </span>
        <button v-if="!profile || profile.plan === 'free'" id="upgradeBtn" class="btn-mini" @click="openUpgrade()">
          升级
        </button>
        <button v-else id="manageSubBtn" class="btn-mini" @click="manageSubscription">管理</button>
      </div>
      <div v-if="quotaCount && usedCount != null" class="quota-bar">
        <i :class="{ urgent: quotaUrgent }" :style="{ width: usagePct + '%' }"></i>
      </div>
    </section>

    <button id="syncNow" class="btn-primary btn-block btn-sync" :disabled="syncBusy" @click="syncNow">
      {{ syncBusy ? "同步中…" : "立即同步" }}
    </button>

    <p id="statusLine" class="status">
      {{ status }}<span v-if="activeSpace && spaces.length > 1"> · 空间: {{ activeSpace.name }}</span>
    </p>

    <div class="seg tools-seg">
      <button
        type="button"
        :class="{ on: activePanel === 'key' }"
        @click="togglePanel('key')"
      >
        同步密钥
      </button>
      <button
        type="button"
        :class="{ on: activePanel === 'spaceDevice' }"
        @click="togglePanel('spaceDevice')"
      >
        空间与设备
      </button>
    </div>

    <!-- 同步密钥（E2EE） -->
    <Transition name="drop">
      <div v-if="activePanel === 'key'" id="keyPanel" class="panel">
        <div class="panel-title">同步方式</div>
        <div class="seg seg-sm">
          <button type="button" :class="{ on: encryptMode === 'e2ee' }" @click="changeEncryptMode('e2ee')">
            加密同步
          </button>
          <button type="button" :class="{ on: encryptMode === 'plain' }" @click="changeEncryptMode('plain')">
            明文同步
          </button>
        </div>
        <p class="panel-desc">
          加密同步：书签内容端到端加密，服务器看不到你的收藏，换设备需同一把密钥或口令。
          明文同步：内容以明文存服务器，更省事但不保护内容隐私。
        </p>
        <template v-if="encryptMode === 'e2ee'">
          <div v-if="keyValue" class="key-box">
            <span class="key-text">{{ keyValue }}</span>
            <button class="btn-sm" @click="copyKey">复制</button>
          </div>
          <div class="input-row">
            <input
              v-model="keyImportInput"
              class="input mono"
              placeholder="粘贴密钥（新设备导入）"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn-sm btn-solid" :disabled="!keyImportInput" @click="doImportKey">导入</button>
          </div>
          <div class="input-row">
            <input
              v-model="keyPhraseInput"
              class="input"
              type="password"
              placeholder="或用同一句口令设定（至少 8 位）"
              autocomplete="new-password"
            />
            <button class="btn-sm" :disabled="!keyPhraseInput" @click="doSetKeyByPhrase">设定</button>
          </div>
        </template>
        <p v-if="keyMsg" class="panel-hint">{{ keyMsg }}</p>
      </div>
    </Transition>

    <!-- 空间 / 设备 -->
    <Transition name="drop">
      <div v-if="activePanel === 'spaceDevice'" id="spaceDevicePanel" class="panel">
        <div class="panel-title">同步空间</div>
        <p class="panel-desc">每个空间是一棵独立书签树，可分别绑定不同浏览器资料（如工作 / 个人）。</p>

        <div v-for="s in spaces" :key="s.id" class="row">
          <template v-if="renamingId === s.id">
            <input
              v-model="renameInput"
              class="input"
              maxlength="50"
              aria-label="空间名称"
              @keyup.enter="submitRename(s)"
              @keyup.esc="renamingId = ''"
            />
            <button class="btn-sm btn-solid" :disabled="!renameInput.trim()" @click="submitRename(s)">保存</button>
            <button class="btn-sm" @click="renamingId = ''">取消</button>
          </template>
          <template v-else>
            <span
              class="row-name"
              :class="{ active: activeSpace?.id === s.id }"
              title="点击切换到该空间"
              @click="doSwitchSpace(s)"
            >
              {{ s.name }}<span v-if="s.is_default" class="row-sub">默认</span>
            </span>
            <button class="btn-sm" @click="startRename(s)">改名</button>
            <button
              v-if="!s.is_default"
              class="btn-sm"
              :class="{ armed: armed === `space:${s.id}` }"
              @click="doDeleteSpace(s)"
            >
              {{ armed === `space:${s.id}` ? "确认删除" : "删除" }}
            </button>
          </template>
        </div>

        <div class="input-row">
          <input
            v-model="newSpaceName"
            class="input"
            placeholder="新空间名称"
            maxlength="50"
            aria-label="新空间名称"
            @keyup.enter="doCreateSpace"
          />
          <button class="btn-sm btn-solid" :disabled="!newSpaceName.trim() || spaceBusy" @click="doCreateSpace">
            创建
          </button>
        </div>
        <p class="panel-hint">空间数量：Free 1 个 · Plus 3 个 · Pro / Lifetime 10 个</p>

        <div class="panel-title device-title">同步中的浏览器</div>
        <div v-for="d in devices" :key="d.device_id" class="row">
          <span class="row-name plain">
            {{ deviceLabel(d) }}
            <span v-if="d.device_id === myDeviceId" class="tag-this">本设备</span>
            <span v-if="deviceSpaceName(d)" class="row-sub">{{ deviceSpaceName(d) }}</span>
          </span>
          <span class="row-time">{{ fmt(d.last_sync_at) }}</span>
          <button
            v-if="d.device_id !== myDeviceId"
            class="btn-sm"
            :class="{ armed: armed === `device:${d.device_id}` }"
            @click="doRemoveDevice(d)"
          >
            {{ armed === `device:${d.device_id}` ? "确认解除" : "解除" }}
          </button>
        </div>
        <p v-if="!devices.length" class="panel-hint">尚无记录，完成一次同步后自动登记。</p>
        <p v-else class="panel-hint">
          「解除」用于电脑转手 / 重装等场景：该浏览器会退出列表，它之前的删除记录一并清除，不再影响你的书签。
        </p>
      </div>
    </Transition>
  </div>

  <!-- 升级 Modal -->
  <Transition name="fade">
    <div v-if="showUpgradeModal" class="mask" @click.self="showUpgradeModal = false">
      <div class="modal">
        <h3>升级解锁更多书签</h3>
        <div class="plan-card" @click="startCheckout('plus')">
          <div class="plan-head">
            <span class="plan-tag plus">Plus</span>
            <span class="price">$20<small>/年</small></span>
          </div>
          <ul>
            <li>最多 10,000 条书签</li>
            <li>3 个同步空间</li>
            <li>设备数量不限</li>
          </ul>
          <button class="btn-primary" :disabled="checkoutBusy">{{ checkoutBusy ? "跳转中…" : "订阅 Plus" }}</button>
        </div>
        <div class="plan-card" @click="startCheckout('pro')">
          <div class="plan-head">
            <span class="plan-tag pro">Pro</span>
            <span class="price">$50<small>/年</small></span>
          </div>
          <ul>
            <li>书签数量无限</li>
            <li>10 个同步空间</li>
            <li>设备数量不限</li>
          </ul>
          <button class="btn-primary" :disabled="checkoutBusy">{{ checkoutBusy ? "跳转中…" : "订阅 Pro" }}</button>
        </div>
        <div class="modal-actions">
          <button class="btn-outline" @click="showUpgradeModal = false">稍后再说</button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 首同步决策 Modal（设备 × 空间 首次同步且需决策） -->
  <Transition name="fade">
    <div v-if="showFirstSyncModal" class="mask" @click.self="dismissFirstSync">
      <div class="modal">
        <h3>首次同步此空间</h3>
        <template v-if="firstSyncInfo?.remoteEncrypted">
          <p class="muted">
            云端书签已开启端到端加密，本设备还没有同步密钥，无法读取云端数据。
            请先导入密钥或输入同一句口令，再选择如何同步。
          </p>
          <div class="input-row">
            <input
              v-model="firstSyncKeyInput"
              class="input mono"
              placeholder="粘贴密钥（44 字符）"
              autocomplete="off"
              spellcheck="false"
            />
            <button class="btn-sm btn-solid" :disabled="!firstSyncKeyInput" @click="importFirstSyncKey">导入</button>
          </div>
          <div class="input-row">
            <input
              v-model="firstSyncPhraseInput"
              class="input"
              type="password"
              placeholder="或用同一句口令设定（至少 8 位）"
              autocomplete="new-password"
              @keyup.enter="phraseFirstSyncKey"
            />
            <button class="btn-sm" :disabled="!firstSyncPhraseInput" @click="phraseFirstSyncKey">设定</button>
          </div>
          <p v-if="firstSyncKeyMsg" class="panel-hint">{{ firstSyncKeyMsg }}</p>
        </template>
        <template v-else>
          <p class="muted">
            本机 {{ firstSyncInfo?.localCount ?? "?" }} 条 · 云端 {{ firstSyncInfo?.remoteCount ?? "?" }} 条书签。
            请选择如何处理：
          </p>
          <button class="fs-btn btn-primary" @click="firstSyncMerge">合并（推荐）</button>
          <p class="fs-desc">双方书签都保留，删除双向生效。</p>
          <button
            class="fs-btn fs-overwrite"
            :class="{ armed: overwriteArmed }"
            @click="firstSyncOverwrite"
          >
            {{ overwriteArmed ? "再次点击确认覆盖本机" : "用云端覆盖本机" }}
          </button>
          <p class="fs-desc">
            云端的 {{ firstSyncInfo?.remoteCount ?? "?" }} 条书签会同步到本机；
            本机有、云端没有的 {{ firstSyncInfo?.localOnlyCount ?? "?" }} 条书签将被删除。
          </p>
        </template>
        <div class="modal-actions">
          <button class="btn-outline" @click="dismissFirstSync">暂不同步</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style>
/* ---------- 基础（黑白主题） ---------- */
* {
  box-sizing: border-box;
}
body {
  --fg: #0a0a0a;
  --fg-2: #6f6f6f;
  --fg-3: #a3a3a3;
  --line: #e8e8e6;
  --surface: #f6f6f4;
  --r: 12px;
  --r-sm: 9px;
  font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  max-width: 420px;
  margin: 40px auto;
  padding: 0 16px 40px;
  color: var(--fg);
  background: #fff;
}
body.popup {
  width: 400px;
  max-width: none;
  margin: 0;
  padding: 18px 16px 20px;
}
h1 {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 0.2px;
}
.muted {
  font-size: 12px;
  color: var(--fg-2);
}

/* ---------- Logo ---------- */
.logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--fg);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.logo svg {
  width: 17px;
  height: 17px;
}
.logo-lg {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  margin: 0 auto;
}
.logo-lg svg {
  width: 26px;
  height: 26px;
}

/* ---------- 按钮 ---------- */
button {
  font-family: inherit;
}
:focus-visible {
  outline: 2px solid var(--fg);
  outline-offset: 2px;
}
.btn-primary {
  padding: 11px 14px;
  border: 1px solid var(--fg);
  border-radius: var(--r-sm);
  background: var(--fg);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.06s;
}
.btn-primary:hover {
  background: #262626;
  border-color: #262626;
}
.btn-primary:active {
  transform: scale(0.985);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn-block {
  display: block;
  width: 100%;
}
.btn-sync {
  margin-top: 14px;
  padding: 12px;
}
.btn-mini {
  flex: none;
  padding: 4px 12px;
  border: 1px solid var(--fg);
  border-radius: 999px;
  background: transparent;
  color: var(--fg);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.btn-mini:hover {
  background: var(--fg);
  color: #fff;
}
.btn-sm {
  flex: none;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: var(--fg);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.btn-sm:hover {
  border-color: var(--fg);
}
.btn-sm.btn-solid {
  background: var(--fg);
  border-color: var(--fg);
  color: #fff;
}
.btn-sm.btn-solid:disabled {
  opacity: 0.4;
  cursor: default;
}
.btn-sm.armed {
  background: var(--fg);
  border-color: var(--fg);
  color: #fff;
}
.btn-outline {
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: #fff;
  color: var(--fg);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.btn-outline:hover {
  border-color: var(--fg);
}
.link {
  border: none;
  background: none;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--fg-2);
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.15s;
}
.link:hover {
  color: var(--fg);
}

/* ---------- 输入框 ---------- */
.input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  color: var(--fg);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input::placeholder {
  color: var(--fg-3);
}
.input:focus {
  outline: none;
  border-color: var(--fg);
  box-shadow: 0 0 0 3px rgba(10, 10, 10, 0.07);
}
.input.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.input-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.input-row .input {
  flex: 1;
  min-width: 0;
}

/* ---------- 分段选择 ---------- */
.seg {
  display: flex;
  background: var(--surface);
  border-radius: 10px;
  padding: 3px;
}
.seg button {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  color: var(--fg-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.seg button.on {
  background: var(--fg);
  color: #fff;
  font-weight: 600;
}
.seg-sm button {
  padding: 5px 0;
  font-size: 12px;
}

/* ---------- 未登录 ---------- */
.auth {
  padding-top: 30px;
  text-align: center;
}
.auth .brand h1 {
  margin-top: 12px;
  font-size: 18px;
}
.sub {
  font-size: 12.5px;
  color: var(--fg-2);
  margin: 5px 0 20px;
}
.auth .seg {
  margin-bottom: 14px;
}
.auth .input {
  text-align: left;
  margin-bottom: 10px;
}
.auth .btn-primary {
  margin-top: 2px;
}
.auth .status {
  margin-top: 12px;
}

/* ---------- 已登录头部 ---------- */
.head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.head-main {
  flex: 1;
  min-width: 0;
}
.email {
  margin: 1px 0 0;
  font-size: 12px;
  color: var(--fg-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---------- 配额 ---------- */
.quota {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--surface);
  border-radius: var(--r);
}
.quota-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quota-num {
  margin-left: auto;
  font-size: 12px;
  color: var(--fg-2);
  font-variant-numeric: tabular-nums;
}
.plan-tag {
  flex: none;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid #c9c9c6;
  color: var(--fg-2);
}
.plan-tag.plus {
  background: #3d3d3b;
  border-color: #3d3d3b;
  color: #fff;
}
.plan-tag.pro,
.plan-tag.lifetime,
.plan-tag.premium {
  background: var(--fg);
  border-color: var(--fg);
  color: #fff;
}
.quota-bar {
  height: 5px;
  margin-top: 11px;
  background: #e0e0dd;
  border-radius: 999px;
  overflow: hidden;
}
.quota-bar i {
  display: block;
  height: 100%;
  background: var(--fg);
  border-radius: 999px;
  transition: width 0.3s;
}
.quota-bar i.urgent {
  background: repeating-linear-gradient(45deg, var(--fg) 0 6px, #555 6px 12px);
}

/* ---------- 状态行 ---------- */
.status {
  margin-top: 10px;
  min-height: 17px;
  font-size: 12px;
  color: var(--fg-2);
  text-align: center;
  word-break: break-all;
  line-height: 1.5;
}

/* ---------- 工具面板 tab ---------- */
.tools-seg {
  margin-top: 12px;
}

/* ---------- 面板 ---------- */
.panel {
  margin-top: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--r);
}
.panel-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
}
.device-title {
  margin-top: 16px;
}
.panel-desc {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--fg-2);
  line-height: 1.6;
}
.panel-hint {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--fg-3);
  line-height: 1.5;
  word-break: break-all;
}

/* ---------- 行 ---------- */
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid #f1f1ef;
}
.row .input {
  flex: 1;
  width: auto;
  min-width: 0;
}
.row-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  word-break: break-all;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.row-name.plain {
  cursor: default;
}
.row-name.active {
  font-weight: 600;
}
.row-name.active::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg);
  flex: none;
}
.row-sub {
  font-size: 10.5px;
  color: var(--fg-3);
}
.row-time {
  font-size: 11px;
  color: var(--fg-3);
  white-space: nowrap;
}
.tag-this {
  flex: none;
  font-size: 10px;
  background: var(--fg);
  color: #fff;
  border-radius: 999px;
  padding: 2px 7px;
}

/* ---------- 密钥管理 ---------- */
.key-box {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.key-text {
  flex: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--fg-2);
  word-break: break-all;
  background: var(--surface);
  border-radius: var(--r-sm);
  padding: 8px;
}

/* ---------- Modal ---------- */
.mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgba(10, 10, 10, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.modal {
  width: 100%;
  max-width: 330px;
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.22);
}
.modal h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.modal .muted {
  text-align: left;
  margin: 0;
  line-height: 1.6;
}
.plan-card {
  margin-top: 10px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.plan-card:hover {
  border-color: var(--fg);
}
.plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.price {
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.price small {
  font-size: 11px;
  font-weight: 400;
  color: var(--fg-2);
  margin-left: 1px;
}
.plan-card ul {
  margin: 8px 0 10px;
  padding-left: 18px;
  font-size: 12px;
  color: var(--fg-2);
  text-align: left;
}
.plan-card li {
  margin: 2px 0;
}
.plan-card .btn-primary {
  display: block;
  width: 100%;
  padding: 8px;
  font-size: 13px;
}
.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.modal-actions > button {
  flex: 1;
}
/* 首同步决策 modal */
.fs-btn {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 9px 14px;
  font-size: 13px;
}
.fs-overwrite {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: #fff;
  color: var(--fg);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.fs-overwrite:hover {
  border-color: var(--fg);
}
.fs-overwrite.armed {
  background: var(--fg);
  border-color: var(--fg);
  color: #fff;
}
.fs-desc {
  margin: 5px 0 0;
  font-size: 11.5px;
  color: var(--fg-3);
  line-height: 1.5;
  text-align: left;
}

/* ---------- 过渡 ---------- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.drop-enter-active,
.drop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
