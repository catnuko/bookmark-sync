<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "./lib/ext.js";
import { supabase } from "./lib/supabase.js";
import { runSync } from "./sync.js";

const session = ref(null);
const email = ref("");
const password = ref("");
const mode = ref("login"); // 'login' | 'register'
const busy = ref(false);
const syncBusy = ref(false);
const status = ref("");

const userEmail = computed(() => session.value?.user?.email ?? "");

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : "从未";
}

async function refreshStatus(extra) {
  const s = await api.storage.local.get(["lastSyncAt", "lastSyncStatus"]);
  status.value =
    extra ?? `上次同步: ${fmt(s.lastSyncAt)}${s.lastSyncStatus ? " · " + s.lastSyncStatus : ""}`;
}

onMounted(async () => {
  const { data } = await supabase.auth.getSession();
  session.value = data.session;
  if (session.value) refreshStatus();
  supabase.auth.onAuthStateChange((_e, s) => {
    session.value = s;
    if (s) refreshStatus();
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
      // 自动确认（关闭 "Confirm email"）时注册即登录；否则等待邮件确认
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
  } finally {
    busy.value = false;
  }
}

async function logout() {
  await supabase.auth.signOut();
  session.value = null;
  status.value = "已退出登录";
}

async function syncNow() {
  syncBusy.value = true;
  refreshStatus("同步中…");
  try {
    const r = await runSync();
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: r.ok ? `推送 ${r.pushed} · 拉取 ${r.pulled}` : r.reason,
    });
    refreshStatus(r.ok ? `完成: 推送 ${r.pushed} · 拉取 ${r.pulled}` : r.reason);
  } catch (e) {
    refreshStatus(`失败: ${e?.message ?? e}`);
  } finally {
    syncBusy.value = false;
  }
}
</script>

<template>
  <h3>Bookmark Sync</h3>

  <div v-if="session">
    <p class="muted">已登录: {{ userEmail }}</p>
    <div class="btns">
      <button id="syncNow" :disabled="syncBusy" @click="syncNow">立即同步</button>
      <button id="logout" @click="logout">退出登录</button>
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
</template>

<style>
body {
  font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  max-width: 420px;
  margin: 40px auto;
  padding: 0 16px;
  color: #222;
}
h3 { margin: 0 0 8px; }
.muted { font-size: 13px; color: #666; }
label { display: block; margin: 16px 0 4px; font-size: 13px; color: #555; }
input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
.btns { display: flex; gap: 8px; margin-top: 20px; }
button { flex: 1; padding: 8px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; background: #eee; color: #222; }
button.primary { background: #4B3FE3; color: #fff; }
button:disabled { opacity: 0.5; cursor: default; }
.switch { margin: 12px 0 0; font-size: 13px; }
.switch a { color: #4B3FE3; text-decoration: none; }
.status { margin-top: 16px; font-size: 13px; color: #666; min-height: 18px; word-break: break-all; }
</style>