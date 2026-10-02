/**
 * Public API for the Move-CRDT sync layer (Phase C-2).
 */

export type { PushOp, OpRow, PullResult, PushResult, OpLogTransport } from './oplogClient.js';
export { MemoryOpLogTransport, SupabaseOpLogTransport, seqOf } from './oplogClient.js';
export type { SupabaseRpcClient } from './oplogClient.js';

export { encryptMoveOp, decryptMoveOp } from './opCrypto.js';
export type { EncryptedOpEnvelope } from './opCrypto.js';

export { SyncCoordinator } from './syncEngine.js';
export type { SyncCoordinatorOptions, PullOutcome } from './syncEngine.js';

export { KeyManager } from './keyManager.js';
export type { KVStore } from './keyManager.js';

export {
  captureLocalEvents,
  captureLocalTree,
  reverseApply,
  retireFallbackFolders,
  IdBridge,
  IS_FIREFOX,
  computePosition,
  nativeRootPairs,
  LANDING_ROOT_UUIDS,
  BROWSER_ROOT_IDS,
} from './chromeBridge.js';
export type {
  ChromeBookmarksAPI,
  ChromeTreeNode,
  IdBridgeOptions,
  CaptureEventHooks,
} from './chromeBridge.js';

// 跨设备一致的内容指纹（「内容认领」轮：按内容认领已有 uuid，避免重复同步）。
export { contentKey } from './contentFingerprint.js';

// 运行时根解析（Chrome 双子树：按 folderType + syncing 认根，id 不固定）。
export { resolveRoots } from './rootResolver.js';
export type { RootResolution } from './rootResolver.js';

// 设备 ↔ 空间的绑定决策（首绑该不该问用户，见 binding.ts 的文件注释）。
export {
  firstBindAction,
  isPaidPlan,
  normalizeBindMode,
  parseBinding,
  bindGateNeeded,
} from './binding.js';
export type { FirstBindAction, BindMode, StoredBinding, BindingResolution } from './binding.js';
