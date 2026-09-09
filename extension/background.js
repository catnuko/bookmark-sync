// 后台: 定时触发同步（Chrome MV3 service worker / Safari 16.4+）
import { api, runSync } from "./sync.js";

async function sync() {
  try {
    const r = await runSync();
    if (r.ok) {
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: `推送 ${r.pushed} · 拉取 ${r.pulled}`,
      });
    }
  } catch (e) {
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: `失败: ${e?.message ?? e}`,
    });
  }
}

api.alarms.create("bookmark-sync", { periodInMinutes: 2 });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bookmark-sync") sync();
});
api.runtime.onInstalled.addListener(sync);
api.runtime.onStartup.addListener(sync);
