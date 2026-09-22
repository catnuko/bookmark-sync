// 后台 service worker（MV3）—— Move-CRDT 操作日志模型
//   - onInstalled / onStartup：全量首拉 + 本地事件捕获
//   - chrome.alarms：每 30 分钟增量 pull（afterId 水位）
//   - 本地书签变更由 chrome.bookmarks 事件驱动，入队后随下一次 flush 推送
import { api, type ExtensionMessage } from './lib/ext.js';
import { describeError } from './lib/errors.js';
import {
  runSync,
  registerLocalEventBridge,
  resetCoordinator,
  rebindSpace,
  bindSpace,
  type SyncRunResult,
} from './sync.js';
import { registerTestChannel } from './testChannel.js';
import { installLogBridge } from './logBridge.js';

// vite define 注入的构建时间（见 vite.config.js）
declare const __BUILD_TIME__: string;

// 日志桥接：SW 中所有 console.log 自动转发到 options 页面控制台
installLogBridge();

// SW 启动标识：打印构建时间 + 启动时间，方便判断是否是最新打包的代码
console.log('[bsync] ===== SW booted =====');
console.log('[bsync] Build time:', __BUILD_TIME__);
console.log('[bsync] Boot time: ', new Date().toISOString());

const ALARM_NAME = 'bsync-periodic-pull';
const AUTO_SYNC_KEY = 'crdt.autoSync';

// 自动同步开关（默认开）：关闭时 onInstalled / onStartup / 周期 alarm 不再
// 自动同步；popup/options 的「立即同步」消息与事件桥 flush 的推送不受影响
// （事件桥的 flushSoon 在 sync.js 内单独检查该开关）。
async function autoSyncEnabled(): Promise<boolean> {
  const s = await api.storage.local.get(AUTO_SYNC_KEY);
  return s[AUTO_SYNC_KEY] !== false;
}

// MV3：chrome.* 持久事件监听必须在 SW 顶层注册（SW 每次被唤醒都会重跑本文件）。
// 事件桥在 coordinator 未就绪（未登录/无空间）时安全跳过，由 runSync 播种兜底。
registerLocalEventBridge();
// 测试通道（仅 Firefox E2E；生产无测试桥扩展，通道天然不可达）
registerTestChannel();

async function sync(): Promise<SyncRunResult> {
  try {
    const r = await runSync();
    if (r.ok) {
      // 与 store.js summarize 同款方向摘要：持久层只存机器可读摘要 JSON，
      // 展示层（store.js summaryText）再按浏览器语言本地化。
      const p = r.pushed || 0,
        q = r.pulled || 0;
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: 'ok',
        lastSyncStatusDetail: '',
        lastSyncSummary: JSON.stringify({
          seeded: !!r.seeded,
          restored: !!r.restored,
          push: p > 0,
          pull: q > 0,
          dec: r.decryptFailed || 0,
        }),
      });
    } else {
      await api.storage.local.set({
        lastSyncAt: Date.now(),
        lastSyncStatus: 'error',
        lastSyncStatusDetail: `${r.reason ?? 'unknown'}${r.error ? ` (${r.error})` : ''}`,
        lastSyncSummary: '',
      });
    }
    notifyUiRefreshed();
    return r;
  } catch (e) {
    const detail = describeError(e);
    const r: SyncRunResult = { ok: false, reason: 'error', error: detail };
    await api.storage.local.set({
      lastSyncAt: Date.now(),
      lastSyncStatus: 'error',
      lastSyncStatusDetail: `error (${detail})`,
      lastSyncSummary: '',
    });
    notifyUiRefreshed();
    return r;
  }
}

// 自动同步（事件桥 flushSoon / 定时拉取）跑完后，通知开着的 popup/options
// 刷新状态——否则 UI 里的书签数、最后同步时间还停留在打开时的旧值。
function notifyUiRefreshed(): void {
  try {
    api.runtime.sendMessage({ type: 'bsync-sync-done' }).catch(() => {
      // 没有 popup 开着时 sendMessage 会 reject，忽略
    });
  } catch {
    /* ignore */
  }
}

// popup/options 通过消息触发 SW 内的同步（SW 是同步权威：事件桥与
// coordinator 同 realm，避免 popup/SW 各持一份 CRDT 状态）。
api.runtime.onMessage.addListener((msg: ExtensionMessage, _sender, sendResponse) => {
  if (msg?.type === 'bsync-sync') {
    sync().then(sendResponse);
    return true; // 异步 sendResponse
  }
  if (msg?.type === 'bsync-reset-coordinator') {
    // popup 导入新密钥 / 设置口令后，通知 SW 重置 coordinator 单例，
    // 否则 SW 仍用旧 CryptoKey 解密 → 全部 op 报解密失败。
    resetCoordinator();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'bsync-space-bind') {
    // 首绑（新设备第一次同步前的显式选择）同样由 SW 执行：绑定后立刻同步一次，
    // 让本机书签并入目标空间（merge）或由目标空间重建本机书签（overwrite）。
    // 消息契约保证 spaceId 为空间 id 字符串（由 store.doBindSpace 发送）。
    bindSpace(msg.spaceId as string, { mode: msg.mode === 'overwrite' ? 'overwrite' : 'merge' })
      .then(async (r) => {
        if (r?.ok) await sync();
        sendResponse(r ?? { ok: false, reason: 'unknown' });
      })
      .catch((e) => sendResponse({ ok: false, reason: 'error', error: describeError(e) }));
    return true; // 异步 sendResponse
  }
  if (msg?.type === 'bsync-space-rebind') {
    // 换绑空间必须由 SW 执行：只有 SW 持有与事件桥同 realm 的 coordinator 单例，
    // 「清空本机前把原空间的未推送 op 推完」才等得到真实队列。换绑成功后立刻
    // 同步一次，把目标空间的书签重新投影到本机。
    // 消息契约保证 spaceId 为空间 id 字符串（由 store.doRebindSpace 发送）。
    rebindSpace(msg.spaceId as string)
      .then(async (r) => {
        if (r?.ok) await sync();
        sendResponse(r ?? { ok: false, reason: 'unknown' });
      })
      .catch((e) => sendResponse({ ok: false, reason: 'error', error: describeError(e) }));
    return true; // 异步 sendResponse
  }
  return false;
});

// 注册 30 分钟周期 alarm（MV3 service worker 可被回收，alarm 是唯一可靠定时器）
function scheduleAlarms(): void {
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
