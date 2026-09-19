/**
 * IndexedDB schema for bookmark-crdt-sync.
 *
 * Database: "bookmark-crdt-sync".
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
 *   5. outbox      — keyPath `key` = `${spaceId}:${seq}` (v2). 未确认推送
 *                    成功的本地 op（含 spaceId）；SW 冷启动经 restoreOutbox
 *                    重放。唯一事实：行存在 = 该 op 尚未确认推送成功。
 *                    Index `by_space` on `spaceId`（按空间恢复）。
 *
 * The CRDT's tree Map is not structured-clone friendly across engines in a
 * way that survives schema evolution guarantees, so we serialize it to an
 * array of [child, {parent, meta}] pairs before writing (see persistence.ts).
 */

export const DB_NAME = 'bookmark-crdt-sync';
export const DB_VERSION = 2;

export const STORE_OPS = 'ops';
export const STORE_SNAPSHOT = 'snapshot';
export const STORE_UUID_MAPPING = 'uuidMapping';
export const STORE_META = 'meta';
export const STORE_OUTBOX = 'outbox';

export const INDEX_BY_TIMESTAMP = 'by_timestamp';
export const INDEX_BY_UUID = 'by_uuid';
export const INDEX_BY_SPACE = 'by_space';

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

      // 5. outbox (v2): 未确认推送成功的本地 op，按 spaceId 建索引供恢复。
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outbox = db.createObjectStore(STORE_OUTBOX, { keyPath: 'key' });
        outbox.createIndex(INDEX_BY_SPACE, 'spaceId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}
