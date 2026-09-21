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
  barRootId,
  LANDING_ROOT_UUIDS,
} from './chromeBridge.js';
export type {
  ChromeBookmarksAPI,
  ChromeTreeNode,
  IdBridgeOptions,
} from './chromeBridge.js';

// 多空间落地（B2 多容器并存）：空间 → chrome 落地区解析 + 容器注册表。
export {
  SPACE_ROOTS_KEY,
  FIXED_ROOT_UUIDS,
  loadSpaceRoots,
  saveSpaceRoots,
  persistSpaceLanding,
  resolveSpaceLanding,
} from './spaceLanding.js';
export type {
  LandingStorage,
  SpaceLanding,
  SpaceLandingRow,
  SpaceRootsRegistry,
  SpaceLike,
} from './spaceLanding.js';
