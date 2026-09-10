<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import { runSync, listSnapshots, restoreSnapshot, getProfile } from "./sync.js";

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

// 付费档案 + 升级 modal
const profile = ref(null); // { plan, quota_bytes, used_bytes, purchased_at }
const showUpgradeModal = ref(false);

// Creem checkout URL 占位（接入 Creem 后替换为真实链接）
const CREEM_CHECKOUT = "https://bookmarksync.app/pricing#creem-premium";

const userEmail = computed(() => session.value?.user?.email ?? "");

const planLabel = computed(() => {
  return profile.value?.plan === "premium" ? "Premium" : "Free";
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
  }
  supabase.auth.onAuthStateChange(async (_e, s) => {
    session.value = s;
    if (s) {
      await refreshStatus();
      await refreshProfile();
    } else {
      profile.value = null;
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

async function logout() {
  await supabase.auth.signOut();
  session.value = null;
  profile.value = null;
  status.value = "已退出登录";
}

async function syncNow() {
  syncBusy.value = true;
  refreshStatus("同步中…");
  try {
    const r = await runSync();
    if (!r.ok && r.reason === "quota_exceeded") {
      // 空间不足，弹升级 modal
      showUpgradeModal.value = true;
      refreshStatus("空间不足，请升级到 Premium");
      return;
    }
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: r.ok ? `推送 ${r.pushed} · 拉取 ${r.pulled}` : r.reason,
    });
    refreshStatus(r.ok ? `完成: 推送 ${r.pushed} · 拉取 ${r.pulled}` : r.reason);
    // 同步后刷新配额显示
    if (r.ok) await refreshProfile();
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
      refreshStatus("历史回滚是 Premium 专属功能");
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
  if (api.tabs?.create) {
    api.tabs.create({ url: CREEM_CHECKOUT });
  } else {
    window.open(CREEM_CHECKOUT, "_blank");
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
    </div>

    <div v-if="showHistory" class="history">
      <div v-for="s in snapshots" :key="s.id" class="history-item">
        <span class="history-time">{{ fmt(s.created_at) }}</span>
        <button class="small" :disabled="syncBusy" @click="restore(s.id)">恢复</button>
      </div>
      <p v-if="!snapshots.length" class="muted">暂无历史记录</p>
      <p v-if="profile?.plan === 'free'" class="muted hint">
        历史回滚是 Pro 专属功能，点击恢复可查看升级选项
      </p>
    </div>

    <div class="status">{{ status }}</div>
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
        <h4>升级 Premium 解锁完整功能</h4>
        <div class="modal-option" @click="openUpgrade()">
          <div class="modal-opt-head">
            <span class="plan-tag premium">Premium</span>
            <span class="modal-price">¥99</span>
          </div>
          <ul>
            <li>20 MB 书签空间</li>
            <li>100 条历史快照</li>
            <li>历史版本回滚</li>
            <li>所有未来新增功能</li>
            <li>邮件支持（7 天回复）</li>
          </ul>
          <button class="primary small">立即升级</button>
        </div>
        <button class="ghost small" @click="showUpgradeModal = false">稍后再说</button>
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
.modal-option ul { margin: 0 0 12px 0; padding-left: 18px; font-size: 12px; color: #555; text-align: left; }
.modal-option li { margin: 2px 0; }

/* Modal 过渡 */
.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
