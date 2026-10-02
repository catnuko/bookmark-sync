// 后台 service worker（MV3）—— Move-CRDT 操作日志模型
//   - onInstalled / onStartup：全量首拉 + 本地事件捕获
//   - chrome.alarms：每 30 分钟增量 pull（afterId 水位）
//   - 本地书签变更由 chrome.bookmarks 事件驱动，入队后随下一次 flush 推送
import { api, type ExtensionMessage } from './lib/ext.js';
import { describeError } from './lib/errors.js';
import { reportError } from './lib/telemetry.js';
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

// 真实「崩溃」入口：SW 里未捕获的异常 / rejection 在 MV3 下只会静默死掉
// （事件处理器的 Promise reject 不写任何日志），必须显式挂全局钩子 —— 这也是
// 唯一能看到「连 catch 都没进」的错误的地方。钩子自身不会抛（reportError 全吞）。
const globalHooks = globalThis as unknown as {
  addEventListener?: (
    type: string,
    listener: (ev: { error?: unknown; reason?: unknown }) => void,
  ) => void;
};
globalHooks.addEventListener?.('error', (ev) => {
  void reportError('crash', 'uncaught', ev?.error ?? ev);
});
globalHooks.addEventListener?.('unhandledrejection', (ev) => {
  void reportError('rejection', 'unhandled', ev?.reason ?? ev);
});

// 自动同步**始终开启**（2026-10-02 起不再提供用户开关）：onInstalled / onStartup /
// 周期 alarm 都会直接同步，无需再查任何开关。
// ---- 登录态切换：真账号根出现 → 静默去抖后收敛 ----
// Chrome 登录后从 Google 拉回账号子树时，真账号根作为 syncing 子树出现。若本机
// 此前由「回退文件夹」代表该根（登出期），必须尽快收敛：退休回退 + 内容认领
// （把「最长 30 分钟的本地重复窗口」压到「拉取完成后几秒」）。
//
// ⚠ 绝不能一出现真根就立刻同步：拉取途中 reverseApply 会给「Chrome 尚未拉回的
// 内容」在本机造出节点，随后被 onCreated 当新节点捕获 → 永久 CRDT 重复。故等
// 书签事件静默若干秒再跑一次完整同步（复用 runSync 的认领 / 退休 / 反向应用）。
const ROOT_RECONCILE_SETTLE_MS = 5000;
let rootReconcileArmed = false;
let rootReconcileTimer: ReturnType<typeof setTimeout> | null = null;
function resetRootReconcileTimer(): void {
  if (!rootReconcileArmed) return;
  if (rootReconcileTimer) clearTimeout(rootReconcileTimer);
  rootReconcileTimer = setTimeout(() => {
    rootReconcileTimer = null;
    rootReconcileArmed = false;
    void (async () => {
      console.log('[bsync] 真账号根出现后静默收敛：开始同步');
      await sync();
    })();
  }, ROOT_RECONCILE_SETTLE_MS);
}

// MV3：chrome.* 持久事件监听必须在 SW 顶层注册（SW 每次被唤醒都会重跑本文件）。
// 事件桥在 coordinator 未就绪（未登录/无空间）时安全跳过，由 runSync 播种兜底。
registerLocalEventBridge({
  // 每个书签事件重置静默计时器（登录拉取期间事件密集 → 拉取结束才收敛）。
  onAnyEvent: () => resetRootReconcileTimer(),
  onRealRootAppeared: (landingUuid, chromeId) => {
    console.log(`[bsync] 检测到真账号根出现: landing=${landingUuid} chromeId=${chromeId}`);
    rootReconcileArmed = true;
    resetRootReconcileTimer();
  },
});
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
          unplaced: r.unplaced || 0,
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
    void reportError('background', 'error', e);
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
      .catch((e) => {
        void reportError('bind', 'error', e, { op: 'bind-space' });
        sendResponse({ ok: false, reason: 'error', error: describeError(e) });
      });
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
      .catch((e) => {
        void reportError('rebind', 'error', e, { op: 'rebind-space' });
        sendResponse({ ok: false, reason: 'error', error: describeError(e) });
      });
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
  await sync();
});
api.runtime.onStartup.addListener(async () => {
  scheduleAlarms();
  await sync();
});
api.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) sync();
});
