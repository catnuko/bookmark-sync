/**
 * IndexedDB schema for bookmark-crdt-sync (Phase 1).
 *
 * Database: "bookmark-crdt-sync", version 1.
 *
 * Object stores:
 *   1. ops         — keyPath `opKey` = `${counter}:${replicaId}`.
 *                    Stores every MoveOp ever applied (for crash replay).
 *                    Index `by_timestamp` on `t.counter`.
 *   2. snapshot    — keyPath `id`. Exactly one row `{id:'current', ...}`:
 *                    a serialized CrdtState + counter + replicaId + opCount.
 *   3. uuidMapping — keyPath `chromeId`. {chromeId, uuid, folderType?}.
 *                    Index `by_uuid` on `uuid` (reverse lookup).
 *   4. meta        — keyPath `key`. Scalar bookkeeping (e.g. replicaId).
 *
 * The CRDT's tree Map is not structured-clone friendly across engines in a
 * way that survives schema evolution guarantees, so we serialize it to an
 * array of [child, {parent, meta}] pairs before writing (see persistence.ts).
 */

export const DB_NAME = 'bookmark-crdt-sync';
export const DB_VERSION = 1;

export const STORE_OPS = 'ops';
export const STORE_SNAPSHOT = 'snapshot';
export const STORE_UUID_MAPPING = 'uuidMapping';
export const STORE_META = 'meta';

export const INDEX_BY_TIMESTAMP = 'by_timestamp';
export const INDEX_BY_UUID = 'by_uuid';

/** Key for the single snapshot row. */
export const SNAPSHOT_KEY = 'current';

/** meta-store keys. */
export const META_REPLICA_ID = 'replicaId';
export const META_COUNTER = 'counter';

/**
 * Build the primary key for an op row. `opKey = counter:replicaId` is
 * unique (counter is unique within a replica, replicaId is global), which
 * makes repeated appendOp of the same op idempotent (put overwrites).
 */
export function opKey(counter: number, replicaId: string): string {
  return `${counter}:${replicaId}`;
}

/**
 * Open (creating/upgrading as needed) the IndexedDB database.
 *
 * Accepts a global `IDBFactory` (the browser provides `indexedDB`; tests
 * inject fake-indexeddb's). Returns an open IDBDatabase.
 */
export function openBookmarkDb(
  factory: IDBFactory,
  dbName: string = DB_NAME,
  version: number = DB_VERSION,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, version);
    req.onupgradeneeded = () => {
      const db = req.result;

      // 1. ops: MoveOp rows, keyed by opKey.
      if (!db.objectStoreNames.contains(STORE_OPS)) {
        const ops = db.createObjectStore(STORE_OPS, { keyPath: 'opKey' });
        // Index by logical counter for range queries (replay newer-than-snapshot).
        ops.createIndex(INDEX_BY_TIMESTAMP, 't.counter', { unique: false });
      }

      // 2. snapshot: single row.
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
        db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'id' });
      }

      // 3. uuidMapping: chromeId -> {chromeId, uuid, folderType?}.
      if (!db.objectStoreNames.contains(STORE_UUID_MAPPING)) {
        const map = db.createObjectStore(STORE_UUID_MAPPING, {
          keyPath: 'chromeId',
        });
        map.createIndex(INDEX_BY_UUID, 'uuid', { unique: true });
      }

      // 4. meta: scalar key/value rows.
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}
