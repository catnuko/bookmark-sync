/**
 * Public API for the Move-CRDT core (ported verbatim from bookmark-crdt-sync).
 *
 * Usage:
 *   import { Replica, ROOT_NODE_ID, TRASH_NODE_ID, positionBetween } from './index.js';
 *
 * NOTE: do_op / undo_op / redo_op / apply_op are a line-for-line port of
 * Fig.4 in Kleppmann et al., "A highly-available move operation for
 * replicated trees", IEEE TPDS 33(7), 2021. Do NOT refactor their logic.
 */

export type {
  CrdtState,
  Edge,
  LogMove,
  Metadata,
  MoveOp,
  Timestamp,
} from './types.js';
export { ROOT_NODE_ID, TRASH_NODE_ID } from './types.js';

export { cmpTimestamp, makeTimestamp } from './timestamp.js';
export { ancestor, get_parent } from './tree.js';
export {
  apply_op,
  do_op,
  redo_op,
  undo_op,
  emptyState,
  logMoveToOp,
} from './moveCrdt.js';
export { Replica } from './replica.js';
export type { SnapshotData } from './replica.js';
export { positionBetween, evenPositions, compactPositions } from './fractionalIndex.js';

// Persistence (IndexedDB ops log + snapshot + chromeId<->UUID mapping).
export * from './storage/index.js';
// E2EE primitives (AES-256-GCM key mgmt). Operation-level encryption of the
// whole MoveOp lives in src/sync/opCrypto.ts.
export * from './crypto/index.js';
