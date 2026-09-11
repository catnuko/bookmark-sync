// 后台: 安装/启动时触发一次同步，其余靠 popup 手动触发
import { api } from "./lib/ext.js";
import { runSync } from "./sync.js";

async function sync() {
  try {
    const r = await runSync();
    if (r.ok) {
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: `推送 ${r.pushed} · 拉取 ${r.pulled}`,
      });
    } else {
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: `未同步: ${r.reason ?? "未知"}`,
      });
    }
  } catch (e) {
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: `失败: ${e?.message ?? e}`,
    });
  }
}

api.runtime.onInstalled.addListener(sync);
api.runtime.onStartup.addListener(sync);