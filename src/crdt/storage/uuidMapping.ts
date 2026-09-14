/**
 * chromeId <-> UUID bidirectional mapping persistence (Phase 1).
 *
 * Why a mapping? Chrome assigns its own ids to bookmark nodes (strings like
 * "12"). The CRDT uses UUIDs. We persist a stable, bidirectional map so that
 * across browser restarts the same chromeId always maps to the same CRDT
 * UUID, and remote ops referencing a UUID can be translated back to chromeId.
 *
 * Special root nodes (bookmarks bar / other / mobile) have FIXED UUIDs so
 * that every device converges on the same root topology. These are NOT
 * arbitrary random UUIDs: they are v4-formatted constants with the variant
 * and version bits set, and they are always present in the mapping.
 *
 * NOTE: Chrome's own root node id is "0". Per the design, the CRDT's logical
 * ROOT_NODE_ID (`__root__`) does not correspond to any Chrome node. Chrome's
 * "0" maps to ROOT_UUID and sits as a child of `__root__`.
 */

import {
  INDEX_BY_UUID,
  STORE_UUID_MAPPING,
} from './schema.js';

/** A persisted mapping row. */
export interface UuidMappingRow {
  chromeId: string;
  uuid: string;
  /** 'bookmarks-bar' | 'other' | 'mobile' | 'managed' for special folders. */
  folderType?: string;
}

/**
 * Fixed UUIDs for Chrome's well-known root folders. Identical on every
 * device so replicas agree on the root topology without negotiation.
 *
 * Layout (CRDT parent pointers):
 *   __root__
 *     └─ ROOT_UUID                      (Chrome root node id "0")
 *          ├─ BOOKMARKS_BAR_UUID        (Chrome "1", folderType 'bookmarks-bar')
 *          ├─ OTHER_BOOKMARKS_UUID      (Chrome "2", folderType 'other')
 *          ├─ MOBILE_UUID               (Chrome "3", folderType 'mobile')
 *          └─ MENU_UUID                 (Firefox "menu________" 书签菜单;
 *                                        Chromium 端映射 bsync 自动管理的
 *                                        「书签菜单」文件夹，无固定 chromeId)
 */
export const ROOT_UUID = '00000000-0000-4000-8000-000000000000';
export const BOOKMARKS_BAR_UUID = '00000000-0000-4000-8000-000000000001';
export const OTHER_BOOKMARKS_UUID = '00000000-0000-4000-8000-000000000002';
export const MOBILE_UUID = '00000000-0000-4000-8000-000000000003';
/** 书签菜单固定根（Firefox menu________；Chromium 端为 bsync 管理的文件夹）。 */
export const MENU_UUID = '00000000-0000-4000-8000-000000000004';

/**
 * chromeId of Chrome's root and its three standard children.
 * These ids are stable across Chrome installations (see chrome.bookmarks API).
 * TODO(real-chrome): verify on a real profile that ids "1"/"2"/"3" really map
 * to bookmarks-bar / other / mobile. The chrome.bookmarks API exposes these
 * via `bookmarks.getTree()` root children whose `folderType` field names them;
 * we fall back to folderType if the numeric ids differ.
 *   ref: https://developer.chrome.com/docs/extensions/reference/api/bookmarks
 */
export const CHROME_ROOT_ID = '0';
export const CHROME_BOOKMARKS_BAR_ID = '1';
export const CHROME_OTHER_ID = '2';
export const CHROME_MOBILE_ID = '3';

/** The canonical special-root mapping table, seeded on first run. */
export const SPECIAL_ROOT_ROWS: UuidMappingRow[] = [
  { chromeId: CHROME_ROOT_ID, uuid: ROOT_UUID },
  { chromeId: CHROME_BOOKMARKS_BAR_ID, uuid: BOOKMARKS_BAR_UUID, folderType: 'bookmarks-bar' },
  { chromeId: CHROME_OTHER_ID, uuid: OTHER_BOOKMARKS_UUID, folderType: 'other' },
  { chromeId: CHROME_MOBILE_ID, uuid: MOBILE_UUID, folderType: 'mobile' },
];

function txComplete<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
  });
}

/**
 * Persistent chromeId <-> UUID mapping. Thin promise wrapper over the
 * `uuidMapping` object store. No caching here — runtime caching lives in
 * IdMapper (src/extension/idMapping.ts).
 */
export class UuidMappingStore {
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  /** chromeId -> UUID, or null if unmapped. */
  async getUuid(chromeId: string): Promise<string | null> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    const row = await txComplete<UuidMappingRow | undefined>(
      tx.objectStore(STORE_UUID_MAPPING).get(chromeId),
    );
    return row ? row.uuid : null;
  }

  /** UUID -> chromeId, or null if unmapped (uses the by_uuid index). */
  async getChromeId(uuid: string): Promise<string | null> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    const index = tx.objectStore(STORE_UUID_MAPPING).index(INDEX_BY_UUID);
    const row = await txComplete<UuidMappingRow | undefined>(index.get(uuid));
    return row ? row.chromeId : null;
  }

  /** Insert or overwrite a mapping. Idempotent on repeated calls. */
  async setMapping(
    chromeId: string,
    uuid: string,
    folderType?: string,
  ): Promise<void> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readwrite');
    const row: UuidMappingRow = folderType
      ? { chromeId, uuid, folderType }
      : { chromeId, uuid };
    await txComplete(tx.objectStore(STORE_UUID_MAPPING).put(row));
    await txDone(tx);
  }

  /** Every mapping row (used to warm the in-memory cache). */
  async getAll(): Promise<UuidMappingRow[]> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    return txComplete<UuidMappingRow[]>(
      tx.objectStore(STORE_UUID_MAPPING).getAll(),
    );
  }

  /** Drop the mapping for `chromeId` (e.g. after a permanent delete). */
  async removeByChromeId(chromeId: string): Promise<void> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readwrite');
    await txComplete(tx.objectStore(STORE_UUID_MAPPING).delete(chromeId));
    await txDone(tx);
  }
}

/** Wait for a transaction to finish (resolve on complete, reject on error). */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction error'));
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
  });
}
