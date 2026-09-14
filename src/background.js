// 后台 service worker（MV3）—— Move-CRDT 操作日志模型
//   - onInstalled / onStartup：全量首拉 + 本地事件捕获
//   - chrome.alarms：每 30 分钟增量 pull（afterId 水位）
//   - 本地书签变更由 chrome.bookmarks 事件驱动，入队后随下一次 flush 推送
import { api } from "./lib/ext.js";
import { runSync } from "./sync.js";

const ALARM_NAME = "bsync-periodic-pull";

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
        lastSyncStatus: `未同步: ${r.reason ?? "未知"}${r.error ? ` (${r.error})` : ""}`,
      });
    }
  } catch (e) {
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: `失败: ${e?.message ?? e}`,
    });
  }
}

// 注册 30 分钟周期 alarm（MV3 service worker 可被回收，alarm 是唯一可靠定时器）
function scheduleAlarms() {
  if (api.alarms?.create) {
    api.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
  }
}

api.runtime.onInstalled.addListener(async () => {
  scheduleAlarms();
  await sync();
});
api.runtime.onStartup.addListener(async () => {
  scheduleAlarms();
  await sync();
});
api.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) sync();
});
