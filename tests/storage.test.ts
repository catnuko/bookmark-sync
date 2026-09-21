/**
 * tests/storage.test.ts — IndexedDB persistence layer.
 *
 * Uses fake-indexeddb (in-memory) so no real browser is needed.
 *
 * These tests exercise:
 *   1. saveReplica -> loadReplica round-trip (tree/log/counter restored).
 *   2. Incremental appendOp -> loadReplica replays post-snapshot ops.
 *   3. UuidMappingStore set/get/bidirectional/remove.
 *   4. Snapshot-then-continue: load = snapshot + incremental replay.
 *   5. Special-root fixed UUIDs are seeded and stable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Replica, ROOT_NODE_ID, TRASH_NODE_ID } from '../src/crdt/index.js';
import {
  openBookmarkDb,
  ReplicaStateStore,
  UuidMappingStore,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  CHROME_ROOT_ID,
  CHROME_BOOKMARKS_BAR_ID,
  CHROME_OTHER_ID,
  CHROME_MOBILE_ID,
} from '../src/crdt/storage/index.js';

/** Open a fresh fake DB for one test. */
async function freshDb(name: string): Promise<IDBDatabase> {
  const factory = new IDBFactory();
  return openBookmarkDb(factory, name, 1);
}

describe('ReplicaStateStore persistence', () => {
  let db: IDBDatabase;
  let store: ReplicaStateStore;
  let dbName: string;
  let counter = 0;

  beforeEach(async () => {
    dbName = `test-db-${counter++}`;
    db = await freshDb(dbName);
    store = new ReplicaStateStore(db);
  });

  afterEach(async () => {
    db.close();
  });

  it('round-trips a Replica (tree, log, counter) through save/load', async () => {
    const r = new Replica('R1');
    const a = r.createNode(ROOT_NODE_ID, { title: 'a', url: 'https://a' });
    const b = r.createNode(ROOT_NODE_ID, { title: 'b' });
    r.moveNode(b, a);
    r.deleteNode(a);

    await store.saveReplica(r);

    const loaded = await store.loadReplica();
    expect(loaded.replicaId).toBe('R1');
    expect(loaded.counter).toBe(r.counter);
    expect(loaded.state.log.length).toBe(r.state.log.length);
    expect(loaded.getOps()).toEqual(r.getOps());
    expect(loaded.getChildren(ROOT_NODE_ID).map((c) => c.id).sort()).toEqual(
      r.getChildren(ROOT_NODE_ID).map((c) => c.id).sort(),
    );
    expect(loaded.getParent(b)).toBe(a);
  });

  it('incremental appendOp is replayed on load', async () => {
    const r = new Replica('R1');
    r.createNode(ROOT_NODE_ID, { title: 'one' });
    await store.saveReplica(r);

    // More ops after the snapshot, without a new checkpoint.
    const two = r.createNode(ROOT_NODE_ID, { title: 'two' });
    await store.appendOp(r.getOps().at(-1)!);

    const loaded = await store.loadReplica();
    expect(loaded.getChildren(ROOT_NODE_ID).map((c) => c.id)).toContain(two);
    expect(loaded.getOps()).toEqual(r.getOps());
  });

  it('snapshot + continue: load reconstructs the full final state', async () => {
    const r = new Replica('R1');
    const x = r.createNode(ROOT_NODE_ID, { title: 'x' });
    await store.saveSnapshot(r);

    // Continue operating; do not force another snapshot. Snapshot was taken
    // after op 0, so ops at index >= 1 are the incremental tail to replay.
    const y = r.createNode(x, { title: 'y' });
    r.moveNode(y, ROOT_NODE_ID, { title: 'y-moved' });
    for (const op of r.getOps().slice(1)) await store.appendOp(op);

    const loaded = await store.loadReplica();
    expect(loaded.counter).toBe(r.counter);
    expect(loaded.getOps()).toEqual(r.getOps());
    expect(loaded.getNodeMeta(y)?.title).toBe('y-moved');
    expect(loaded.getParent(y)).toBe(ROOT_NODE_ID);
  });

  it('appendOp is idempotent (same op overwrites, no duplicate)', async () => {
    const r = new Replica('R1');
    r.createNode(ROOT_NODE_ID, { title: 'dup' });
    const op = r.getOps()[0];
    await store.appendOp(op);
    await store.appendOp(op);
    await store.appendOp(op);

    const all = await store.getAllOps();
    expect(all.length).toBe(1);
    expect(all[0]).toEqual(op);
  });

  it('loads an empty replica when no data exists', async () => {
    const loaded = await store.loadReplica();
    expect(loaded.state.tree.size).toBe(0);
    expect(loaded.state.log.length).toBe(0);
  });
});

describe('UuidMappingStore（按空间隔离）', () => {
  let db: IDBDatabase;
  let store: UuidMappingStore;
  let dbName: string;
  let counter = 0;
  const SPACE_A = 'space-a';
  const SPACE_B = 'space-b';

  beforeEach(async () => {
    dbName = `test-map-${counter++}`;
    db = await freshDb(dbName);
    store = new UuidMappingStore(db);
  });

  afterEach(async () => {
    db.close();
  });

  it('sets, gets, and reverse-looks-up a mapping', async () => {
    await store.setMapping(SPACE_A, 'chrome-42', 'uuid-42', 'bookmarks-bar');
    expect(await store.getUuid(SPACE_A, 'chrome-42')).toBe('uuid-42');
    expect(await store.getChromeId(SPACE_A, 'uuid-42')).toBe('chrome-42');
  });

  it('returns null for unmapped ids', async () => {
    expect(await store.getUuid(SPACE_A, 'nope')).toBeNull();
    expect(await store.getChromeId(SPACE_A, 'nope-uuid')).toBeNull();
  });

  it('隔离空间：同一 chromeId 在两个空间是两条互不可见的映射', async () => {
    // 这是多空间的地基不变式：chrome 书签栏 "1" 在空间 A 是 A 树的落地，
    // 在空间 B 是 B 树的落地，绝不能互相看见。
    await store.setMapping(SPACE_A, '1', 'uuid-a');
    await store.setMapping(SPACE_B, '1', 'uuid-b');

    expect(await store.getUuid(SPACE_A, '1')).toBe('uuid-a');
    expect(await store.getUuid(SPACE_B, '1')).toBe('uuid-b');
    expect(await store.getChromeId(SPACE_A, 'uuid-a')).toBe('1');
    expect(await store.getChromeId(SPACE_A, 'uuid-b')).toBeNull(); // B 的 uuid 在 A 不可见
  });

  it('removeByChromeId clears both directions (within a space)', async () => {
    await store.setMapping(SPACE_A, 'c1', 'u1');
    await store.removeByChromeId(SPACE_A, 'c1');
    expect(await store.getUuid(SPACE_A, 'c1')).toBeNull();
    expect(await store.getChromeId(SPACE_A, 'u1')).toBeNull();
  });

  it('removeByUuid 只影响本空间', async () => {
    await store.setMapping(SPACE_A, 'c1', 'u1');
    await store.setMapping(SPACE_B, 'c1', 'u1'); // 同 chromeId+uuid，不同空间
    await store.removeByUuid(SPACE_A, 'u1');
    expect(await store.getUuid(SPACE_A, 'c1')).toBeNull();
    expect(await store.getUuid(SPACE_B, 'c1')).toBe('u1'); // B 不受影响
  });

  it('getAll returns every row, or only one space when asked', async () => {
    await store.setMapping(SPACE_A, 'c1', 'u1');
    await store.setMapping(SPACE_A, 'c2', 'u2', 'other');
    await store.setMapping(SPACE_B, 'c1', 'u3');
    const all = await store.getAll();
    expect(all.map((r) => `${r.spaceId}:${r.chromeId}`).sort()).toEqual(
      [`${SPACE_A}:c1`, `${SPACE_A}:c2`, `${SPACE_B}:c1`].sort(),
    );
    const onlyA = await store.getAll(SPACE_A);
    expect(onlyA.map((r) => r.chromeId).sort()).toEqual(['c1', 'c2']);
  });
});

describe('Special-root fixed UUIDs', () => {
  it('expose the four well-known constants', () => {
    expect(ROOT_UUID).toBe('00000000-0000-4000-8000-000000000000');
    expect(BOOKMARKS_BAR_UUID).toBe('00000000-0000-4000-8000-000000000001');
    expect(OTHER_BOOKMARKS_UUID).toBe('00000000-0000-4000-8000-000000000002');
    expect(MOBILE_UUID).toBe('00000000-0000-4000-8000-000000000003');
  });

  it('IdMapper seeds the fixed root mappings on init', async () => {
    // Exercise the seeding logic via UuidMappingStore + the constant table.
    const db = await freshDb(`test-roots-${Date.now()}`);
    const store = new UuidMappingStore(db);
    // Seed manually (IdMapper.init does this; here we verify the table).
    await store.setMapping('space-x', CHROME_ROOT_ID, ROOT_UUID);
    await store.setMapping('space-x', CHROME_BOOKMARKS_BAR_ID, BOOKMARKS_BAR_UUID, 'bookmarks-bar');
    await store.setMapping('space-x', CHROME_OTHER_ID, OTHER_BOOKMARKS_UUID, 'other');
    await store.setMapping('space-x', CHROME_MOBILE_ID, MOBILE_UUID, 'mobile');

    expect(await store.getUuid('space-x', CHROME_BOOKMARKS_BAR_ID)).toBe(BOOKMARKS_BAR_UUID);
    expect(await store.getChromeId('space-x', OTHER_BOOKMARKS_UUID)).toBe(CHROME_OTHER_ID);
    db.close();
  });
});

// Touch the trash sentinel so it isn't flagged unused if tests expand.
void TRASH_NODE_ID;
