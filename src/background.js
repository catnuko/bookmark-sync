// 后台 service worker（MV3）—— Move-CRDT 操作日志模型
//   - onInstalled / onStartup：全量首拉 + 本地事件捕获
//   - chrome.alarms：每 30 分钟增量 pull（afterId 水位）
//   - 本地书签变更由 chrome.bookmarks 事件驱动，入队后随下一次 flush 推送
import { api } from "./lib/ext.js";
import { runSync, registerLocalEventBridge } from "./sync.js";

const ALARM_NAME = "bsync-periodic-pull";

// MV3：chrome.* 持久事件监听必须在 SW 顶层注册（SW 每次被唤醒都会重跑本文件）。
// 事件桥在 coordinator 未就绪（未登录/无空间）时安全跳过，由 runSync 播种兜底。
registerLocalEventBridge();

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
    return r;
  } catch (e) {
    const r = { ok: false, reason: "error", error: e?.message ?? String(e) };
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: `失败: ${e?.message ?? e}`,
    });
    return r;
  }
}

// popup/options 通过消息触发 SW 内的同步（SW 是同步权威：事件桥与
// coordinator 同 realm，避免 popup/SW 各持一份 CRDT 状态）。
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "bsync-sync") {
    sync().then(sendResponse);
    return true; // 异步 sendResponse
  }
  return false;
});

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
