import { api, runSync } from "./sync.js";

const $ = (id) => document.getElementById(id);

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : "从未";
}

async function refreshStatus(extra) {
  const s = await api.storage.local.get(["lastSyncAt", "lastSyncStatus"]);
  $("status").textContent =
    extra ?? `上次同步: ${fmt(s.lastSyncAt)}${s.lastSyncStatus ? " · " + s.lastSyncStatus : ""}`;
}

async function load() {
  const cfg = await api.storage.local.get(["serverUrl", "token"]);
  $("serverUrl").value = cfg.serverUrl ?? "";
  $("token").value = cfg.token ?? "";
  refreshStatus();
}

$("save").addEventListener("click", async () => {
  await api.storage.local.set({
    serverUrl: $("serverUrl").value.trim().replace(/\/+$/, ""),
    token: $("token").value.trim(),
  });
  refreshStatus("已保存");
});

$("syncNow").addEventListener("click", async () => {
  $("syncNow").disabled = true;
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
    $("syncNow").disabled = false;
  }
});

load();
