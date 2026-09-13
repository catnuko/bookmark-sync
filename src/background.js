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
    } else if (r.reason === "first_sync_confirm_needed") {
      // 本设备第一次与该空间同步且需要决策（后台不代选，打开扩展时弹决策 UI）
      await api.storage.local.set({
        lastSyncStatus: r.remoteEncrypted
          ? "等待同步密钥: 云端数据已加密，请在扩展中导入密钥后再同步"
          : "等待确认(首同步): 本机与云端都有书签，请在扩展中确认如何同步",
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

api.runtime.onInstalled.addListener(sync);
api.runtime.onStartup.addListener(sync);