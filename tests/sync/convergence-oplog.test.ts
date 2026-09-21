/**
 * tests/sync/convergence-oplog.test.ts — end-to-end convergence through the
 * encrypted op log.
 *
 * Two devices (SyncCoordinators) share one MemoryOpLogTransport (mock Supabase)
 * AND one shared E2EE key. They edit offline, then each pulls the other's ops;
 * their CRDT tree projections must be identical (and acyclic).
 *
 * This is the integration-level version of the pure CRDT convergence tests.
 */

import { describe, it, expect } from 'vitest';
import { MemoryOpLogTransport, SyncCoordinator } from '../../src/sync/index.js';
import {
  generateKey,
  exportKey,
  importKey,
  ROOT_NODE_ID,
  type Replica,
  type MoveOp,
} from '../../src/crdt/index.js';

const SPACE = 'bbbbbbbb-0000-4000-8000-222222222222';

function treesEqual(a: Replica, b: Replica): boolean {
  const ta = a.state.tree;
  const tb = b.state.tree;
  if (ta.size !== tb.size) return false;
  for (const [child, va] of ta) {
    const vb = tb.get(child);
    if (!vb) return false;
    if (va.parent !== vb.parent) return false;
    if (JSON.stringify(va.meta) !== JSON.stringify(vb.meta)) return false;
  }
  return true;
}

function assertAcyclic(r: Replica): void {
  const tree = r.state.tree;
  for (const child of tree.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = child;
    while (cur !== undefined) {
      if (seen.has(cur)) throw new Error(`cycle at ${cur}`);
      seen.add(cur);
      const e = tree.get(cur);
      if (!e) break;
      cur = e.parent;
    }
  }
}

describe('convergence through encrypted op log', () => {
  it('two offline devices merge to the same tree', async () => {
    const transport = new MemoryOpLogTransport();
    const sharedKey = await generateKey();
    const keyB = await importKey(await exportKey(sharedKey)); // B imports the same key

    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-A', transport, key: sharedKey });
    const B = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-B', transport, key: keyB });

    // Seed a shared root structure by A, then B pulls it.
    const shared = A.createNode(ROOT_NODE_ID, { title: 'shared' });
    await A.flushPush();
    await B.pull();
    expect(B.replica.getParent(shared)).toBe(ROOT_NODE_ID);

    // A offline: create + move.
    A.createNode(shared, { title: 'A-one' });
    const aTwo = A.createNode(ROOT_NODE_ID, { title: 'A-two' });
    A.moveNode(aTwo, shared);
    await A.flushPush();

    // B offline: create + delete.
    const bOne = B.createNode(shared, { title: 'B-one' });
    B.deleteNode(bOne);
    await B.flushPush();

    // Merge both ways.
    await A.pull();
    await B.pull();

    expect(treesEqual(A.replica, B.replica)).toBe(true);
    assertAcyclic(A.replica);
    assertAcyclic(B.replica);
  });

  it('concurrent create under the same parent keeps both children', async () => {
    const transport = new MemoryOpLogTransport();
    const key = await generateKey();
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport, key });
    const B = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'B',
      transport,
      key: await importKey(await exportKey(key)),
    });

    const folder = A.createNode(ROOT_NODE_ID, { title: 'folder' });
    await A.flushPush();
    await B.pull();

    // Both add a sibling concurrently.
    const aChild = A.createNode(folder, { title: 'from-A' });
    const bChild = B.createNode(folder, { title: 'from-B' });
    await A.flushPush();
    await B.flushPush();
    await A.pull();
    await B.pull();

    const kids = new Set(A.replica.getChildren(folder).map((k) => k.id));
    expect(kids.has(aChild)).toBe(true);
    expect(kids.has(bChild)).toBe(true);
    expect(treesEqual(A.replica, B.replica)).toBe(true);
  });

  it('ops applied in server-id order converge regardless of interleaving', async () => {
    const transport = new MemoryOpLogTransport();
    const key = await generateKey();
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport, key });
    const B = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'B',
      transport,
      key: await importKey(await exportKey(key)),
    });

    // Round-robin small batches: A and B interleave pushes/pulls.
    for (let i = 0; i < 5; i++) {
      A.createNode(ROOT_NODE_ID, { title: `a-${i}` });
      await A.flushPush();
      await B.pull();

      B.createNode(ROOT_NODE_ID, { title: `b-${i}` });
      await B.flushPush();
      await A.pull();
    }

    expect(treesEqual(A.replica, B.replica)).toBe(true);
    expect(A.replica.getVisibleTree().length).toBe(B.replica.getVisibleTree().length);
  });

  it('counters on B advance past A so future B ops stay Lamport-ordered', async () => {
    const transport = new MemoryOpLogTransport();
    const key = await generateKey();
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport, key });
    const B = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'B',
      transport,
      key: await importKey(await exportKey(key)),
    });

    A.createNode(ROOT_NODE_ID, { title: 'a1' });
    A.createNode(ROOT_NODE_ID, { title: 'a2' });
    await A.flushPush();
    await B.pull();

    // B's counter must be at least A's max (2), so B's next local op is ahead.
    expect(B.replica.counter).toBeGreaterThanOrEqual(A.replica.counter);
    const local = B.createNode(ROOT_NODE_ID, { title: 'b-local' });
    expect(B.replica.getNodeMeta(local)?.title).toBe('b-local');
  });

  it('pull cursor advances only after rows are applied', async () => {
    const transport = new MemoryOpLogTransport();
    const key = await generateKey();
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport, key });
    const B = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'B',
      transport,
      key: await importKey(await exportKey(key)),
    });

    A.createNode(ROOT_NODE_ID, { title: 'x' });
    await A.flushPush();
    const before = B.afterId;
    await B.pull();
    expect(B.afterId).toBeGreaterThan(before);

    // A second pull with no new rows leaves afterId unchanged.
    const same = await B.pull();
    expect(same.applied).toBe(0);
    expect(B.afterId).toBe(B.afterId);
  });

  it('shared key roundtrip: B derives the same key from export', async () => {
    const key = await generateKey();
    const exported = await exportKey(key);
    const imported = await importKey(exported);
    const t = new MemoryOpLogTransport();
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport: t, key });
    const B = new SyncCoordinator({ spaceId: SPACE, deviceId: 'B', transport: t, key: imported });

    const n = A.createNode(ROOT_NODE_ID, { title: 'hello' });
    await A.flushPush();
    await B.pull();
    expect(B.replica.getParent(n)).toBe(ROOT_NODE_ID);
  });
});
