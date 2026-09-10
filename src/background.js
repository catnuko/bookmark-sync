// 后台: 安装/启动时触发一次同步，其余靠 popup 手动触发
// 另监听本地书签增删 → 记录/清除墓碑（删除传播 / 重新添加获胜）
import { api } from "./lib/ext.js";
import { runSync, recordTombstone, clearTombstone } from "./sync.js";

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

// 本地删除书签 → 记录墓碑（下次同步传播删除，避免其他设备复活它）
api.bookmarks?.onRemoved?.addListener(async (_id, removeInfo) => {
  const url = removeInfo?.node?.url;
  if (url) await recordTombstone(url);
});

// 本地重新添加书签 → 清除墓碑（重新添加获胜）
api.bookmarks?.onCreated?.addListener(async (_id, node) => {
  const url = node?.url;
  if (url) await clearTombstone(url);
});

api.runtime.onInstalled.addListener(sync);
api.runtime.onStartup.addListener(sync);
