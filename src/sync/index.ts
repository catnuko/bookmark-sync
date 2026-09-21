/**
 * Public API for the Move-CRDT sync layer (Phase C-2).
 */

export type {
  PushOp,
  OpRow,
  PullResult,
  PushResult,
  OpLogTransport,
} from './oplogClient.js';
export {
  MemoryOpLogTransport,
  SupabaseOpLogTransport,
  seqOf,
} from './oplogClient.js';
export type { SupabaseRpcClient } from './oplogClient.js';

export { encryptMoveOp, decryptMoveOp } from './opCrypto.js';
export type { EncryptedOpEnvelope } from './opCrypto.js';

export { SyncCoordinator } from './syncEngine.js';
export type {
  SyncCoordinatorOptions,
  PullOutcome,
} from './syncEngine.js';

export { KeyManager } from './keyManager.js';
export type { KVStore } from './keyManager.js';

export {
  captureLocalEvents,
  captureLocalTree,
  reverseApply,
  IdBridge,
  IS_FIREFOX,
  computePosition,
  nativeRootPairs,
  LANDING_ROOT_UUIDS,
} from './chromeBridge.js';
export type {
  ChromeBookmarksAPI,
  ChromeTreeNode,
  IdBridgeOptions,
} from './chromeBridge.js';

// 设备 ↔ 空间的绑定决策（首绑必须让用户选，见 binding.ts 的文件注释）。
export { firstBindAction, normalizeBindMode } from './binding.js';
export type { FirstBindAction, BindMode } from './binding.js';
