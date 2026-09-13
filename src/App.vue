<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import {
  runSync, listSnapshots, restoreSnapshot, getProfile,
  getActiveSpace, switchSpace, createSpace, deleteSpace, renameSpace,
  listDevices, getDeviceName, setDeviceName, removeDevice,
  getDeviceId, acknowledgeMerge,
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
const snapshots = ref([]);
const showHistory = ref(false);

// 同步密钥（E2EE）管理：换设备时导出并在新设备导入同一密钥
const showKeyManage = ref(false);
const keyValue = ref("");
const keyImportInput = ref("");
const keyMsg = ref("");
const keyPhraseInput = ref("");
const encryptMode = ref("plain");

// 付费档案 + 升级 modal
const profile = ref(null); // { plan, quota_bytes, used_bytes, purchased_at }
const showUpgradeModal = ref(false);
const checkoutBusy = ref(false);

// 同步空间 + 设备管理
const showSpaceDevice = ref(false);
const spaces = ref([]);
const activeSpace = ref(null);
const devices = ref([]);
const myDeviceId = ref("");
const deviceNameInput = ref("");
const newSpaceName = ref("");
const spaceBusy = ref(false);

// 多设备合并确认 modal（账号下已有其他活跃设备时，首次同步前知情确认）
const showMergeModal = ref(false);
const mergeDevices = ref([]);

async function refreshSpacesDevices() {
  try {
    const { spaces: sp, active } = await getActiveSpace();
    spaces.value = sp;
    activeSpace.value = active;
    devices.value = await listDevices();
    myDeviceId.value = await getDeviceId();
    deviceNameInput.value = await getDeviceName();
  } catch (e) {
    console.warn("[app] refreshSpacesDevices failed:", e?.message ?? e);
  }
}

function toggleSpaceDevice() {
  showSpaceDevice.value = !showSpaceDevice.value;
  if (showSpaceDevice.value && session.value) refreshSpacesDevices();
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

async function doRenameSpace(sp) {
  const name = window.prompt?.(`重命名空间「${sp.name}」`, sp.name);
  if (!name || !name.trim()) return;
  const r = await renameSpace(sp.id, name);
  if (!r.ok) {
    refreshStatus(`重命名失败: ${r.error ?? r.reason}`);
    return;
  }
  await refreshSpacesDevices();
}

async function doDeleteSpace(sp) {
  if (!window.confirm?.(`删除空间「${sp.name}」？该空间的书签数据和删除记录将一并清空，本机书签不受影响。`)) return;
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

async function doRenameDevice() {
  await setDeviceName(deviceNameInput.value);
  await refreshSpacesDevices();
  refreshStatus("设备名称已保存");
}

async function doRemoveDevice(d) {
  if (
    !window.confirm?.(
      `移除设备「${d.name || d.device_id.slice(0, 8)}」？将注销该设备并清除它制造的删除记录（此前它删除的书签不会再被强制同步删除）。`
    )
  )
    return;
  try {
    await removeDevice(d.device_id);
    await refreshSpacesDevices();
    refreshStatus("设备已移除");
  } catch (e) {
    refreshStatus(`移除失败: ${e?.message ?? e}`);
  }
}

// Creem 订阅：调边缘函数创建收银台会话，支付结果由 creem-webhook 翻转服务端 plan
async function startCheckout(plan) {
  if (checkoutBusy.value) return;
  checkoutBusy.value = true;
  status.value = "正在创建支付会话…";
  try {
    const { data, error } = await supabase.functions.invoke("creem-checkout", {
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
    const { data, error } = await supabase.functions.invoke("creem-portal", {
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

const usedMB = computed(() => (profile.value?.used_bytes ?? 0) / 1024 / 1024);
const quotaMB = computed(() => (profile.value?.quota_bytes ?? 0) / 1024 / 1024);
const usagePct = computed(() => {
  const used = profile.value?.used_bytes ?? 0;
  const quota = profile.value?.quota_bytes ?? 1;
  return Math.min(100, Math.round((used / quota) * 100));
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

async function confirmMerge() {
  showMergeModal.value = false;
  await acknowledgeMerge();
  await syncNow({ force: true });
}

async function logout() {
  await supabase.auth.signOut();
  session.value = null;
  profile.value = null;
  spaces.value = [];
  devices.value = [];
  activeSpace.value = null;
  showSpaceDevice.value = false;
  status.value = "已退出登录";
}

async function syncNow(opts = {}) {
  // 注意：模板 @click 直传时 opts 可能是事件对象，统一归一化为 force 布尔
  const force = opts === true || !!opts?.force;
  syncBusy.value = true;
  refreshStatus("同步中…");
  try {
    const r = await runSync({ force });
    if (!r.ok && r.reason === "merge_confirm_needed") {
      // 账号下已有其他活跃设备：先知情确认，再放行合并
      mergeDevices.value = r.devices ?? [];
      showMergeModal.value = true;
      refreshStatus("检测到其他设备正在使用此账号，请确认是否合并书签");
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
      lastSyncStatus: r.ok ? `推送 ${r.pushed} · 拉取 ${r.pulled}` : r.reason,
    });
    refreshStatus(r.ok ? `完成: 推送 ${r.pushed} · 拉取 ${r.pulled}` : r.reason);
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

async function loadHistory() {
  showHistory.value = !showHistory.value;
  if (showHistory.value) {
    try {
      snapshots.value = await listSnapshots();
    } catch (e) {
      status.value = `获取历史失败: ${e?.message ?? e}`;
    }
  }
}

async function restore(id) {
  syncBusy.value = true;
  try {
    const r = await restoreSnapshot(id);
    if (!r.ok && r.reason === "plan_locked") {
      // 免费用户，弹升级 modal
      showUpgradeModal.value = true;
      refreshStatus("历史回滚是付费档位（Plus / Pro）专属功能");
      return;
    }
    if (!r.ok) {
      refreshStatus(`恢复失败: ${r.reason}`);
      return;
    }
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: `恢复 ${r.changes} 项`,
    });
    refreshStatus(`已恢复 ${r.changes} 项变更（快照时间: ${fmt(r.createdAt)}）`);
    snapshots.value = await listSnapshots();
    await refreshProfile();
  } catch (e) {
    refreshStatus(`恢复失败: ${e?.message ?? e}`);
  } finally {
    syncBusy.value = false;
  }
}

function openUpgrade() {
  showUpgradeModal.value = true;
}

async function toggleKeyManage() {
  showKeyManage.value = !showKeyManage.value;
  if (showKeyManage.value) {
    encryptMode.value = await getEncryptMode();
    keyMsg.value = (await hasKey()) ? "" : "本设备尚无密钥，首次同步时会按下方设置自动生成。";
    try {
      keyValue.value = await exportKey();
    } catch {
      keyValue.value = "";
    }
  }
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
  <h3>Bookmark Sync</h3>

  <div v-if="session">
    <p class="muted">已登录: {{ userEmail }}</p>

    <!-- 配额进度条（加载前显示占位，加载后显示真实数据） -->
    <div class="quota">
      <div class="quota-head">
        <span class="plan-tag" :class="profile?.plan ?? 'free'">{{ planLabel }}</span>
        <span class="quota-text">
          <template v-if="profile">
            {{ usedMB.toFixed(2) }} MB / {{ quotaMB.toFixed(0) }} MB
          </template>
          <template v-else>加载中…</template>
        </span>
        <button v-if="!profile || profile.plan === 'free'" class="small upgrade" @click="openUpgrade()">
          升级
        </button>
        <button v-else class="small" @click="manageSubscription">管理订阅</button>
      </div>
      <div class="quota-bar">
        <div class="quota-fill" :class="{ urgent: quotaUrgent }" :style="{ width: usagePct + '%' }"></div>
      </div>
    </div>

    <div class="btns">
      <button id="syncNow" :disabled="syncBusy" @click="syncNow">立即同步</button>
      <button id="logout" @click="logout">退出登录</button>
    </div>
    <div class="btns">
      <button class="ghost" @click="loadHistory">{{ showHistory ? "收起历史" : "历史记录" }}</button>
      <button class="ghost" @click="toggleKeyManage">同步密钥</button>
      <button class="ghost" @click="toggleSpaceDevice">空间 / 设备</button>
    </div>
    <p v-if="activeSpace && spaces.length > 1" class="muted">
      当前空间：{{ activeSpace.name }}
    </p>

    <div v-if="showHistory" class="history">
      <div v-for="s in snapshots" :key="s.id" class="history-item">
        <span class="history-time">{{ fmt(s.created_at) }}</span>
        <button class="small" :disabled="syncBusy" @click="restore(s.id)">恢复</button>
      </div>
      <p v-if="!snapshots.length" class="muted">暂无历史记录</p>
      <p v-if="profile?.plan === 'free'" class="muted hint">
        历史回滚是付费档位专属功能，点击恢复可查看升级选项
      </p>
    </div>

    <div v-if="showKeyManage" class="key-manage">
      <div class="key-mode">
        <span class="muted">同步方式：</span>
        <span class="mode-pill" :class="{ on: encryptMode === 'e2ee' }" @click="changeEncryptMode('e2ee')">加密同步</span>
        <span class="mode-pill" :class="{ on: encryptMode === 'plain' }" @click="changeEncryptMode('plain')">明文同步（默认）</span>
      </div>
      <p class="muted">加密同步：书签内容端到端加密，服务器看不到你的收藏，换设备需同一把密钥或口令。明文同步：内容以明文存服务器，更省事但不保护内容隐私。</p>
      <template v-if="encryptMode === 'e2ee'">
      <div v-if="keyValue" class="key-box">
        <span class="key-text">{{ keyValue }}</span>
        <button class="small" @click="copyKey">复制</button>
      </div>
      <div class="key-import">
        <input v-model="keyImportInput" placeholder="粘贴密钥（新设备导入）" autocomplete="off" spellcheck="false" />
        <button class="small primary" :disabled="!keyImportInput" @click="doImportKey">导入</button>
      </div>
      <div class="key-phrase">
        <span class="muted phrase-hint">或用同一句口令（推荐，免记长串）：</span>
        <div class="key-import">
          <input v-model="keyPhraseInput" type="password" placeholder="设置/输入同步口令（至少 8 位）" autocomplete="new-password" />
          <button class="small" :disabled="!keyPhraseInput" @click="doSetKeyByPhrase">用口令设定</button>
        </div>
      </div>
      <p class="muted hint">{{ keyMsg }}</p>
      </template>
    </div>

    <!-- 空间 / 设备管理 -->
    <div v-if="showSpaceDevice" class="key-manage">
      <div class="sd-title">同步空间</div>
      <p class="muted">每个空间是一棵独立书签树。Chrome 多用户资料可分别绑定不同空间（如工作/个人），避免书签混在一起。</p>
      <div v-for="s in spaces" :key="s.id" class="sd-row">
        <span
          class="sd-name"
          :class="{ on: activeSpace?.id === s.id }"
          title="点击切换到该空间"
          @click="doSwitchSpace(s)"
        >
          {{ s.name }}<span v-if="s.is_default" class="muted">（默认）</span>
        </span>
        <button class="small" @click="doRenameSpace(s)">改名</button>
        <button v-if="!s.is_default" class="small" @click="doDeleteSpace(s)">删除</button>
      </div>
      <div class="key-import">
        <input v-model="newSpaceName" placeholder="新空间名称" maxlength="50" @keyup.enter="doCreateSpace" />
        <button class="small primary" :disabled="!newSpaceName.trim() || spaceBusy" @click="doCreateSpace">创建</button>
      </div>
      <p class="muted hint">空间数量：Free 1 个 · Plus 3 个 · Pro/Lifetime 10 个</p>

      <div class="sd-title">设备</div>
      <div v-for="d in devices" :key="d.device_id" class="sd-row">
        <span class="sd-name">
          {{ d.name || d.device_id.slice(0, 8) }}
          <span v-if="d.device_id === myDeviceId" class="this-tag">本设备</span>
        </span>
        <span class="muted sd-time">{{ fmt(d.last_sync_at) }}</span>
        <button v-if="d.device_id !== myDeviceId" class="small" @click="doRemoveDevice(d)">移除</button>
      </div>
      <p v-if="!devices.length" class="muted">尚无设备记录，完成一次同步后自动登记。</p>
      <div class="key-import">
        <input v-model="deviceNameInput" placeholder="本设备显示名称" maxlength="50" @keyup.enter="doRenameDevice" />
        <button class="small primary" @click="doRenameDevice">保存名称</button>
      </div>
    </div>

    <div class="status">
      {{ status }}
      <span v-if="activeSpace && spaces.length > 1"> · 空间: {{ activeSpace.name }}</span>
    </div>
  </div>

  <div v-else>
    <label for="email">邮箱</label>
    <input id="email" v-model="email" type="email" placeholder="you@example.com" autocomplete="email" />
    <label for="password">密码</label>
    <input id="password" v-model="password" type="password" placeholder="至少 6 位" autocomplete="current-password" />
    <div class="btns">
      <button class="primary" :disabled="busy" @click="submit">
        {{ mode === "login" ? "登录" : "注册" }}
      </button>
    </div>
    <p class="switch">
      <a href="#" @click.prevent="mode = mode === 'login' ? 'register' : 'login'">
        {{ mode === "login" ? "没有账号？注册" : "已有账号？登录" }}
      </a>
    </p>
    <div class="status">{{ status }}</div>
  </div>

  <!-- 升级 Modal -->
  <Transition name="modal">
    <div v-if="showUpgradeModal" class="modal-mask" @click.self="showUpgradeModal = false">
      <div class="modal">
        <h4>升级解锁更多书签</h4>
        <div class="modal-option" @click="startCheckout('plus')">
          <div class="modal-opt-head">
            <span class="plan-tag plus">Plus</span>
            <span class="modal-price">$20<span class="modal-unit">/年</span></span>
          </div>
          <ul>
            <li>最多 10,000 条书签</li>
            <li>多设备同步</li>
            <li>与免费版功能完全一致</li>
          </ul>
          <button class="primary small" :disabled="checkoutBusy">{{ checkoutBusy ? "跳转中…" : "订阅 Plus" }}</button>
        </div>
        <div class="modal-option" @click="startCheckout('pro')">
          <div class="modal-opt-head">
            <span class="plan-tag pro">Pro</span>
            <span class="modal-price">$50<span class="modal-unit">/年</span></span>
          </div>
          <ul>
            <li>书签数量无限</li>
            <li>多设备同步</li>
            <li>与免费版功能完全一致</li>
          </ul>
          <button class="primary small" :disabled="checkoutBusy">{{ checkoutBusy ? "跳转中…" : "订阅 Pro" }}</button>
        </div>
        <button class="ghost small" @click="showUpgradeModal = false">稍后再说</button>
      </div>
    </div>
  </Transition>

  <!-- 多设备合并确认 Modal -->
  <Transition name="modal">
    <div v-if="showMergeModal" class="modal-mask" @click.self="showMergeModal = false">
      <div class="modal">
        <h4>此账号已在其他设备上同步</h4>
        <p class="muted">
          同步会把以下设备的书签与本设备合并（新增双方保留，删除双向生效）。
          如果两台设备本应是两套独立书签，建议先在「空间 / 设备」里为它们绑定不同空间。
        </p>
        <ul class="merge-list">
          <li v-for="d in mergeDevices" :key="d.device_id ?? d.name">
            {{ d.name }} · 上次同步 {{ fmt(d.last_sync_at) }}
          </li>
        </ul>
        <div class="btns">
          <button class="primary" @click="confirmMerge">我知道了，合并同步</button>
          <button class="ghost" @click="showMergeModal = false">先不同步</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style>
body {
  font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  max-width: 420px;
  margin: 40px auto;
  padding: 0 16px;
  color: #222;
}
body.popup {
  width: 400px;
  max-width: none;
  margin: 0;
  padding: 16px;
}
h3 { margin: 0 0 8px; }
.muted { font-size: 13px; color: #666; }
.hint { margin-top: 8px; font-style: italic; }
label { display: block; margin: 16px 0 4px; font-size: 13px; color: #555; }
input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
.btns { display: flex; gap: 8px; margin-top: 12px; }
button { flex: 1; padding: 8px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; background: #eee; color: #222; }
button.primary { background: #4B3FE3; color: #fff; }
button.ghost { background: transparent; border: 1px solid #ddd; font-size: 13px; }
button.small { flex: none; padding: 4px 10px; font-size: 12px; }
button.upgrade { background: #000; color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
.switch { margin: 12px 0 0; font-size: 13px; }
.switch a { color: #4B3FE3; text-decoration: none; }
.status { margin-top: 16px; font-size: 13px; color: #666; min-height: 18px; word-break: break-all; }
.history { margin-top: 12px; max-height: 200px; overflow-y: auto; }
.history-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #eee; }
.history-time { font-size: 12px; color: #666; }

/* 配额进度条 */
.quota { margin: 12px 0; padding: 10px; background: #f7f7f7; border-radius: 8px; }
.quota-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.quota-text { font-size: 12px; color: #666; }
.plan-tag { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
.plan-tag.free { background: #e0e0e0; color: #555; }
.plan-tag.plus { background: #4B3FE3; color: #fff; }
.plan-tag.pro { background: #000; color: #fff; }
.plan-tag.lifetime { background: #000; color: #fff; }
.plan-tag.premium { background: #000; color: #fff; }
.quota-bar { height: 6px; background: #ddd; border-radius: 3px; overflow: hidden; }
.quota-fill { height: 100%; background: #4B3FE3; transition: width 0.3s; }
.quota-fill.urgent { background: #d93025; }

/* 升级 Modal */
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.modal { background: #fff; border-radius: 12px; padding: 20px; max-width: 340px; width: 90%; }
.modal h4 { margin: 0 0 16px; font-size: 16px; }
.modal-option { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; cursor: pointer; transition: border-color 0.2s; text-align: center; }
.modal-option:hover { border-color: #000; }
.modal-opt-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.modal-price { font-size: 16px; font-weight: 700; }
.modal-unit { font-size: 11px; font-weight: 400; margin-left: 2px; }
.modal-option ul { margin: 0 0 12px 0; padding-left: 18px; font-size: 12px; color: #555; text-align: left; }
.modal-option li { margin: 2px 0; }
.modal-option .primary { display: block; width: 100%; }

/* Modal 过渡 */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }

/* 同步密钥（E2EE）管理 */
.key-manage { margin-top: 12px; padding: 10px; background: #f7f7f7; border-radius: 8px; }
.key-mode { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.mode-pill { cursor: pointer; padding: 3px 10px; border-radius: 999px; font-size: 12px; border: 1px solid #ccc; color: #666; user-select: none; }
.mode-pill.on { background: #2f6feb; border-color: #2f6feb; color: #fff; }
.key-box { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.key-text { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #333; word-break: break-all; background: #fff; border: 1px solid #eee; border-radius: 6px; padding: 6px; }
.key-import { display: flex; gap: 8px; }
.key-import input { flex: 1; padding: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.key-phrase { margin-top: 10px; }
.phrase-hint { display: block; margin-bottom: 4px; }

/* 空间 / 设备管理 */
.sd-title { font-weight: 600; margin: 10px 0 4px; font-size: 14px; }
.sd-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.sd-name { flex: 1; font-size: 13px; cursor: pointer; word-break: break-all; }
.sd-name.on { color: #4B3FE3; font-weight: 600; }
.sd-time { font-size: 11px; white-space: nowrap; }
.this-tag { font-size: 10px; background: #e6f4ea; color: #137333; border-radius: 8px; padding: 1px 6px; margin-left: 4px; }
.merge-list { margin: 8px 0 12px; padding-left: 18px; font-size: 13px; color: #444; text-align: left; }
.merge-list li { margin: 2px 0; }
.modal .btns button { flex: 1; }
.modal .muted { text-align: left; }
</style>
