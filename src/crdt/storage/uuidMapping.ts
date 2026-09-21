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

import { INDEX_BY_UUID, INDEX_BY_SPACE, STORE_UUID_MAPPING, mappingKey } from './schema.js';

/** A persisted mapping row（按空间隔离）。 */
export interface UuidMappingRow {
  /** `${spaceId}:${chromeId}`（主键）。 */
  key: string;
  /** 该映射所属的同步空间。 */
  spaceId: string;
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

/**
 * 固定根的（chromeId, uuid, folderType）种子表。
 *
 * 不含 spaceId：同一张表对每个空间各自播种一次（默认空间 = 原生根；容器空间
 * 由 spaceRoots 解析出容器内落地根后传入 IdBridge）。
 */
export interface SpecialRootRow {
  chromeId: string;
  uuid: string;
  folderType?: string;
}

/** The canonical special-root mapping table, seeded once per space. */
export const SPECIAL_ROOT_ROWS: SpecialRootRow[] = [
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
 * Persistent chromeId <-> UUID mapping，**按空间隔离**（v3）。
 *
 * 多空间下同一 chromeId 在不同空间是不同节点，因此所有读写都必须带 spaceId；
 * 行主键为 `${spaceId}:${chromeId}`，与 outbox 的按空间键保持一致。
 *
 * No caching here — runtime caching lives in IdBridge (src/sync/chromeBridge.ts),
 * 其持久化真身是 chrome.storage.local 的 `crdt.idmap.<spaceId>`。
 */
export class UuidMappingStore {
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  /** chromeId -> UUID within `spaceId`, or null if unmapped. */
  async getUuid(spaceId: string, chromeId: string): Promise<string | null> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    const row = await txComplete<UuidMappingRow | undefined>(
      tx.objectStore(STORE_UUID_MAPPING).get(mappingKey(spaceId, chromeId)),
    );
    return row ? row.uuid : null;
  }

  /** UUID -> chromeId within `spaceId`, or null if unmapped (uses the by_uuid index). */
  async getChromeId(spaceId: string, uuid: string): Promise<string | null> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    const index = tx.objectStore(STORE_UUID_MAPPING).index(INDEX_BY_UUID);
    const row = await txComplete<UuidMappingRow | undefined>(index.get([spaceId, uuid]));
    return row ? row.chromeId : null;
  }

  /** Insert or overwrite a mapping. Idempotent on repeated calls. */
  async setMapping(
    spaceId: string,
    chromeId: string,
    uuid: string,
    folderType?: string,
  ): Promise<void> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readwrite');
    const row: UuidMappingRow = {
      key: mappingKey(spaceId, chromeId),
      spaceId,
      chromeId,
      uuid,
      ...(folderType ? { folderType } : {}),
    };
    await txComplete(tx.objectStore(STORE_UUID_MAPPING).put(row));
    await txDone(tx);
  }

  /** Every mapping row (all spaces), or only `spaceId`'s rows when given. */
  async getAll(spaceId?: string): Promise<UuidMappingRow[]> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    const store = tx.objectStore(STORE_UUID_MAPPING);
    if (!spaceId) return txComplete<UuidMappingRow[]>(store.getAll());
    return txComplete<UuidMappingRow[]>(store.index(INDEX_BY_SPACE).getAll(spaceId));
  }

  /** Drop the mapping for `chromeId` in `spaceId` (e.g. after a permanent delete). */
  async removeByChromeId(spaceId: string, chromeId: string): Promise<void> {
    const tx = this.db.transaction(STORE_UUID_MAPPING, 'readwrite');
    await txComplete(tx.objectStore(STORE_UUID_MAPPING).delete(mappingKey(spaceId, chromeId)));
    await txDone(tx);
  }

  /** Drop the mapping for `uuid` in `spaceId` (reverse direction). */
  async removeByUuid(spaceId: string, uuid: string): Promise<void> {
    // IDBIndex 没有 delete()：先经索引取出主键，再删记录。
    // 分两个事务，避免「await 后跨事务边界继续用同一 tx」的自动提交风险。
    const readTx = this.db.transaction(STORE_UUID_MAPPING, 'readonly');
    const pk = await txComplete<IDBValidKey | undefined>(
      readTx.objectStore(STORE_UUID_MAPPING).index(INDEX_BY_UUID).getKey([spaceId, uuid]),
    );
    if (pk === undefined) return;
    const writeTx = this.db.transaction(STORE_UUID_MAPPING, 'readwrite');
    await txComplete(writeTx.objectStore(STORE_UUID_MAPPING).delete(pk));
    await txDone(writeTx);
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
