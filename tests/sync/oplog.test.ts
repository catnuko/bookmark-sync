/**
 * tests/sync/oplog.test.ts — op-log transport: push/pull idempotency +
 * incremental cursor, plus the coordinator's encrypt/decrypt roundtrip.
 *
 * Uses MemoryOpLogTransport (mock Supabase) and a shared AES key.
 */

import { describe, it, expect } from 'vitest';
import { MemoryOpLogTransport, SyncCoordinator } from '../../src/sync/index.js';
import {
  generateKey,
  exportKey,
  importKey,
  ROOT_NODE_ID,
  TRASH_NODE_ID,
  type MoveOp,
} from '../../src/crdt/index.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-111111111111';

describe('oplog transport (mock Supabase)', () => {
  it('push assigns a monotonic global id; pull returns rows with id > afterId', async () => {
    const t = new MemoryOpLogTransport();
    const key = await generateKey();
    const a = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-1', transport: t, key });

    const f1 = a.createNode(ROOT_NODE_ID, { title: 'one' });
    const f2 = a.createNode(ROOT_NODE_ID, { title: 'two' });
    expect(await a.flushPush()).toBe(2);

    // First pull from afterId=0 returns both, in id order.
    const r1 = await t.pull(SPACE, 0);
    expect(r1.rows.length).toBe(2);
    expect(r1.rows[0].id).toBeLessThan(r1.rows[1].id);
    expect(r1.has_more).toBe(false);

    // Incremental pull: afterId = last returned id returns only newer rows.
    await a.deleteNode(f1);
    await a.moveNode(f2, f1);
    expect(await a.flushPush()).toBe(2);

    const r2 = await t.pull(SPACE, r1.last_id);
    expect(r2.rows.length).toBe(2);
    expect(r2.rows[0].id).toBeGreaterThan(r1.last_id);
  });

  it('push is idempotent on (space_id, device_id, seq): re-pushing does not duplicate', async () => {
    const t = new MemoryOpLogTransport();
    const key = await generateKey();
    const a = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-1', transport: t, key });

    a.createNode(ROOT_NODE_ID, { title: 'one' });
    await a.flushPush();
    expect(t.size).toBe(1);

    // Re-run flushPush with nothing new -> nothing sent.
    expect(await a.flushPush()).toBe(0);
    expect(t.size).toBe(1);
  });

  it('coordinator pull decrypts and applies ops from the transport', async () => {
    const t = new MemoryOpLogTransport();
    const key = await generateKey();

    const sender = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-A', transport: t, key });
    const receiver = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'dev-B',
      transport: t,
      key,
    });

    const folder = sender.createNode(ROOT_NODE_ID, { title: 'folder' });
    const child = sender.createNode(folder, { title: 'child' });
    await sender.flushPush();

    const outcome = await receiver.pull();
    expect(outcome.applied).toBe(2);
    expect(receiver.replica.getParent(child)).toBe(folder);
    expect(receiver.replica.getParent(folder)).toBe(ROOT_NODE_ID);
  });

  it('a wrong key silently skips rows (never throws into the pipeline)', async () => {
    const t = new MemoryOpLogTransport();
    const right = await generateKey();
    const wrong = await generateKey();

    const sender = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport: t, key: right });
    const snooper = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'B',
      transport: t,
      key: wrong,
    });

    sender.createNode(ROOT_NODE_ID, { title: 'secret' });
    await sender.flushPush();

    const outcome = await snooper.pull();
    expect(outcome.skipped).toBe(1);
    expect(outcome.applied).toBe(0);
  });

  it('delete op propagates through the log to trash', async () => {
    const t = new MemoryOpLogTransport();
    const key = await generateKey();
    const sender = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport: t, key });
    const receiver = new SyncCoordinator({ spaceId: SPACE, deviceId: 'B', transport: t, key });

    const n = sender.createNode(ROOT_NODE_ID, { title: 'bye' });
    await sender.flushPush();
    await receiver.pull();

    sender.deleteNode(n);
    await sender.flushPush();
    await receiver.pull();

    expect(receiver.replica.getParent(n)).toBe(TRASH_NODE_ID);
  });
});
