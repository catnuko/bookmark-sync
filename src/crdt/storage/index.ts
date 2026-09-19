/**
 * Public API for the IndexedDB persistence layer (Phase 1, Module 1).
 *
 * Usage:
 *   import { openBookmarkDb, ReplicaStateStore, UuidMappingStore } from './storage/index.js';
 *   const db = openBookmarkDb(globalThis.indexedDB);
 *   const stateStore = new ReplicaStateStore(db);
 *   const mapStore = new UuidMappingStore(db);
 */

export {
  DB_NAME,
  DB_VERSION,
  STORE_OPS,
  STORE_SNAPSHOT,
  STORE_UUID_MAPPING,
  STORE_META,
  STORE_OUTBOX,
  INDEX_BY_TIMESTAMP,
  INDEX_BY_UUID,
  INDEX_BY_SPACE,
  SNAPSHOT_KEY,
  META_REPLICA_ID,
  META_COUNTER,
  opKey,
  openBookmarkDb,
} from './schema.js';

export {
  OutboxStore,
  outboxKey,
} from './outbox.js';
export type { OutboxRow } from './outbox.js';

export {
  ReplicaStateStore,
  DEFAULT_SNAPSHOT_THRESHOLD,
  serializeState,
  deserializeState,
} from './persistence.js';
export type {
  OpRow,
  SerializedState,
  SnapshotRow,
} from './persistence.js';

export {
  UuidMappingStore,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
  CHROME_ROOT_ID,
  CHROME_BOOKMARKS_BAR_ID,
  CHROME_OTHER_ID,
  CHROME_MOBILE_ID,
  SPECIAL_ROOT_ROWS,
} from './uuidMapping.js';
export type { UuidMappingRow } from './uuidMapping.js';
