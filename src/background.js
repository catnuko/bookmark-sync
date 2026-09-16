// 后台 service worker（MV3）—— Move-CRDT 操作日志模型
//   - onInstalled / onStartup：全量首拉 + 本地事件捕获
//   - chrome.alarms：每 30 分钟增量 pull（afterId 水位）
//   - 本地书签变更由 chrome.bookmarks 事件驱动，入队后随下一次 flush 推送
import { api } from "./lib/ext.js";
import { runSync, registerLocalEventBridge, resetCoordinator } from "./sync.js";
import { registerTestChannel } from "./testChannel.js";
import { installLogBridge } from "./logBridge.js";

// 日志桥接：SW 中所有 console.log 自动转发到 options 页面控制台
installLogBridge();

// SW 启动标识：打印构建时间 + 启动时间，方便判断是否是最新打包的代码
console.log("[bsync] ===== SW booted =====");
console.log("[bsync] Build time:", __BUILD_TIME__);
console.log("[bsync] Boot time: ", new Date().toISOString());

const ALARM_NAME = "bsync-periodic-pull";
const AUTO_SYNC_KEY = "crdt.autoSync";

// 自动同步开关（默认开）：关闭时 onInstalled / onStartup / 周期 alarm 不再
// 自动同步；popup/options 的「立即同步」消息与事件桥 flush 的推送不受影响
// （事件桥的 flushSoon 在 sync.js 内单独检查该开关）。
async function autoSyncEnabled() {
  const s = await api.storage.local.get(AUTO_SYNC_KEY);
  return s[AUTO_SYNC_KEY] !== false;
}

// MV3：chrome.* 持久事件监听必须在 SW 顶层注册（SW 每次被唤醒都会重跑本文件）。
// 事件桥在 coordinator 未就绪（未登录/无空间）时安全跳过，由 runSync 播种兜底。
registerLocalEventBridge();
// 测试通道（仅 Firefox E2E；生产无测试桥扩展，通道天然不可达）
registerTestChannel();

async function sync() {
  try {
    const r = await runSync();
    if (r.ok) {
      // 与 store.js syncSummary 同款自然语言：不展示 CRDT op 行数（与书签数对不上）。
      const p = r.pushed || 0, q = r.pulled || 0;
      const body = r.seeded
        ? "首次同步完成，书签已加密上传"
        : r.restored
        ? "首次同步完成，已从云端恢复书签"
        : p > 0 && q > 0 ? "双向同步完成"
        : p > 0 ? "已上传本地变更"
        : q > 0 ? "已同步其他设备的变更"
        : "已是最新";
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: body,
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
  if (msg?.type === "bsync-reset-coordinator") {
    // popup 导入新密钥 / 设置口令后，通知 SW 重置 coordinator 单例，
    // 否则 SW 仍用旧 CryptoKey 解密 → 全部 op 报解密失败。
    resetCoordinator();
    sendResponse({ ok: true });
    return false;
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
  if (await autoSyncEnabled()) await sync();
});
api.runtime.onStartup.addListener(async () => {
  scheduleAlarms();
  if (await autoSyncEnabled()) await sync();
});
api.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME && (await autoSyncEnabled())) sync();
});
