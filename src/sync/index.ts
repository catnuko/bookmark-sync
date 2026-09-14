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
  reverseApply,
  IdBridge,
  IS_FIREFOX,
  computePosition,
} from './chromeBridge.js';
export type { ChromeBookmarksAPI, ChromeTreeNode } from './chromeBridge.js';
