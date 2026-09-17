/**
 * tests/sync/snapshot-gc.test.ts — Phase 4 GC snapshots:
 *  - MemoryOpLogTransport.snapshotPull / maybeGc semantics (truncation +
 *    keep-latest-snapshot), mirroring the 0018/0024 RPC contract.
 *  - SyncCoordinator.pullWithSnapshot: rebuild-from-snapshot + incremental
 *    tail, force mode for cold bare replicas, fallback on undecryptable
 *    snapshot, fallback to full replay when force && no snapshot.
 *  - SyncCoordinator.maybeGc: encrypted projection + transport call.
 *  - 数据安全守卫：replica 因解密失败缺行时 maybeGc 拒绝生成投影
 *    （reason='replica_incomplete'），防止残缺快照 + 截断导致 op 永久丢失；
 *    快照重建/全量重放补齐后守卫复位。
 *
 * 注：0024 起 GC 阈值由服务端决定（free 2000 / pro 20000），客户端不再传阈值。
 * 内存传输的阈值改为构造参数（默认 2000），测试传小阈值模拟服务端判定。
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
} from '../../src/sync/index.js';
import {
  generateKey,
  exportKey,
  importKey,
  ROOT_NODE_ID,
} from '../../src/crdt/index.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-222222222222';

async function makePair(threshold = 100) {
  const t = new MemoryOpLogTransport(threshold);
  const key = await generateKey();
  const A = new SyncCoordinator({ spaceId: SPACE, deviceId: 'A', transport: t, key });
  const B = new SyncCoordinator({ spaceId: SPACE, deviceId: 'B', transport: t, key: await importKey(await exportKey(key)) });
  return { t, key, A, B };
}

describe('MemoryOpLogTransport snapshot/GC', () => {
  it('snapshotPull returns null when no snapshot exists', async () => {
    const { t } = await makePair();
    expect(await t.snapshotPull(SPACE)).toBeNull();
  });

  it('maybeGc truncates op rows and keeps the latest snapshot', async () => {
    const { t, A, B } = await makePair(5);
    // A 造 6 条 op（超过阈值 5）
    for (let i = 0; i < 6; i++) A.createNode(ROOT_NODE_ID, { title: `n${i}` });
    expect(await A.flushPush()).toBe(6);

    const before = t.size;
    const gc = await B.maybeGc();
    expect(gc.gced).toBe(true);
    expect(gc.deleted).toBe(6);
    expect(gc.snapshot_id).not.toBeNull();
    expect(t.size).toBe(before - 6);

    // 快照水位 = 截断前的最大 op id
    const snap = await t.snapshotPull(SPACE);
    expect(snap).not.toBeNull();
    expect(snap!.after_op_id).toBe(6);
    expect(snap!.data).not.toBeNull();

    // 再次 GC（已低于阈值）→ 不截断
    const gc2 = await B.maybeGc();
    expect(gc2.gced).toBe(false);
    expect(gc2.deleted).toBe(0);
  });

  it('maybeGc below threshold does nothing', async () => {
    const { t, A } = await makePair(10);
    A.createNode(ROOT_NODE_ID, { title: 'x' });
    await A.flushPush();
    const gc = await A.maybeGc();
    expect(gc.gced).toBe(false);
    expect(await t.snapshotPull(SPACE)).toBeNull();
  });
});

describe('SyncCoordinator.pullWithSnapshot', () => {
  it('rebuilds from snapshot then pulls the incremental tail', async () => {
    const { t, A, B, key } = await makePair(2);
    // A 建 3 个节点 → B 拉取并 GC（阈值 2）→ op_log 截断剩 0
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(A.createNode(ROOT_NODE_ID, { title: `n${i}` }));
    await A.flushPush();
    await B.pullWithSnapshot(false);
    await B.maybeGc();
    expect(t.size).toBe(0);

    // C：全新设备（afterId=0）→ 快照重建 + 增量，完整收敛
    const C = new SyncCoordinator({ spaceId: SPACE, deviceId: 'C', transport: t, key: await importKey(await exportKey(key)) });
    const out = await C.pullWithSnapshot(false);
    expect(out.applied).toBe(0); // 快照重建不走 pull 计数
    for (const id of ids) expect(C.replica.getParent(id)).toBe(ROOT_NODE_ID);

    // 快照重建后仍能增量收尾（快照之后的新 op）
    const late = A.createNode(ROOT_NODE_ID, { title: 'late' });
    await A.flushPush();
    const out2 = await C.pullWithSnapshot(false);
    expect(out2.applied).toBe(1);
    expect(C.replica.getParent(late)).toBe(ROOT_NODE_ID);
  });

  it('incremental pull when snapshot is older than the local cursor', async () => {
    const { t, A, B } = await makePair(0);
    const id1 = A.createNode(ROOT_NODE_ID, { title: 'a' });
    await A.flushPush();
    await B.pullWithSnapshot(false); // B afterId=1
    // 生成快照（水位 1）
    await B.maybeGc();
    // A 又加一条（op id=2）
    const id2 = A.createNode(ROOT_NODE_ID, { title: 'b' });
    await A.flushPush();
    // B 本地水位 1 == 快照水位 1 → 直接增量拉 id2
    const out = await B.pullWithSnapshot(false);
    expect(out.applied).toBe(1);
    expect(B.replica.getParent(id2)).toBe(ROOT_NODE_ID);
    expect(B.replica.getParent(id1)).toBe(ROOT_NODE_ID);
  });

  it('force mode rebuilds from snapshot even when cursor is ahead (cold bare replica)', async () => {
    const { t, A, B } = await makePair(1);
    const id1 = A.createNode(ROOT_NODE_ID, { title: 'a' });
    const id2 = A.createNode(ROOT_NODE_ID, { title: 'b' });
    await A.flushPush();
    await B.pullWithSnapshot(false);
    await B.maybeGc(); // 2 条 op > 阈值 1 → 快照水位 2，op 截断
    // 模拟 B 冷启动：内存 bare + afterId 恢复为 1（从 storage）
    B.afterId = 1;
    const out = await B.pullWithSnapshot(true);
    expect(out.applied).toBe(0);
    expect(B.replica.isBare()).toBe(false);
    expect(B.replica.getParent(id1)).toBe(ROOT_NODE_ID);
    expect(B.replica.getParent(id2)).toBe(ROOT_NODE_ID);
  });

  it('falls back to incremental pull when the snapshot is undecryptable', async () => {
    const { t, A, B } = await makePair(1);
    A.createNode(ROOT_NODE_ID, { title: 'a' });
    A.createNode(ROOT_NODE_ID, { title: 'b' });
    await A.flushPush();
    await B.pullWithSnapshot(false);
    await B.maybeGc(); // 2 条 op > 阈值 1 → 截断留快照
    // 篡改快照投影 → B 解密失败 → 回退增量 pull（此时 op 已被截断，但 B 本地完整）
    const snap = await t.snapshotPull(SPACE);
    snap!.data = { iv: 'AA', ciphertext: 'AA' };
    const out = await B.pullWithSnapshot(false);
    expect(out.applied).toBe(0);
    expect(B.replica.isBare()).toBe(false); // 本地树仍完整
  });

  it('force with no snapshot falls back to full replay from 0', async () => {
    const { t, A, B } = await makePair(1);
    const id1 = A.createNode(ROOT_NODE_ID, { title: 'a' });
    await A.flushPush();
    // B 冷启动（afterId=1，bare，无快照）→ pullFrom(0) 全量
    B.afterId = 1;
    const out = await B.pullWithSnapshot(true);
    expect(out.applied).toBe(1);
    expect(B.replica.getParent(id1)).toBe(ROOT_NODE_ID);
  });
});

describe('SyncCoordinator.maybeGc', () => {
  it('encrypts the projection and lets a fresh device rebuild', async () => {
    const { t, A, B, key } = await makePair(1);
    const folder = A.createNode(ROOT_NODE_ID, { title: 'folder' });
    const child = A.createNode(folder, { title: 'c', url: 'https://x' });
    await A.flushPush();
    await B.pullWithSnapshot(false);
    const gc = await B.maybeGc(); // 2 条 op > 阈值 1 → 截断
    expect(gc.gced).toBe(true);

    // 快照是密文（E2EE 保持），服务端看不到明文
    const snap = await t.snapshotPull(SPACE);
    expect(typeof snap!.data!.ciphertext).toBe('string');
    expect(snap!.data!.ciphertext).not.toContain('https://x');

    // 新设备 C 从快照重建
    const C = new SyncCoordinator({ spaceId: SPACE, deviceId: 'C', transport: t, key: await importKey(await exportKey(key)) });
    await C.pullWithSnapshot(false);
    expect(C.replica.getParent(folder)).toBe(ROOT_NODE_ID);
    expect(C.replica.getParent(child)).toBe(folder);
    expect(C.replica.getNodeMeta(child)?.url).toBe('https://x');
  });

  it('refuses GC when the replica is incomplete (wrong key / decrypt failures)', async () => {
    const { t, A } = await makePair(2);
    for (let i = 0; i < 3; i++) A.createNode(ROOT_NODE_ID, { title: `n${i}` });
    await A.flushPush();

    // 错误密钥的设备：拉取全部解密失败 → replica 缺行（水位越过被跳过的 op）
    const wrongKey = await generateKey();
    const D = new SyncCoordinator({ spaceId: SPACE, deviceId: 'D', transport: t, key: wrongKey });
    const out = await D.pullWithSnapshot(false);
    expect(out.skipped).toBe(3);
    expect(out.applied).toBe(0);

    // GC 被拒绝：不生成投影、不落快照、op 行原样保留（数据不被截断丢失）
    const gc = await D.maybeGc();
    expect(gc.gced).toBe(false);
    expect(gc.reason).toBe('replica_incomplete');
    expect(await t.snapshotPull(SPACE)).toBeNull();
    expect(t.size).toBe(3);
  });

  it('snapshot rebuild clears the incomplete flag and re-enables GC', async () => {
    const { t, A, B, key } = await makePair(2);
    for (let i = 0; i < 3; i++) A.createNode(ROOT_NODE_ID, { title: `n${i}` });
    await A.flushPush();
    await B.pullWithSnapshot(false);
    await B.maybeGc(); // 3 条 > 阈值 2 → 截断留快照
    expect(t.size).toBe(0);

    // C 冷启动（afterId=0, bare）→ 快照重建 → 完整性复位（≤ 水位基线完整）
    const C = new SyncCoordinator({ spaceId: SPACE, deviceId: 'C', transport: t, key: await importKey(await exportKey(key)) });
    await C.pullWithSnapshot(false);

    // 快照之后新增 3 条 → C 增量补齐（零跳过）→ 可正常 GC
    for (let i = 0; i < 3; i++) A.createNode(ROOT_NODE_ID, { title: `late${i}` });
    await A.flushPush();
    const inc = await C.pullWithSnapshot(false);
    expect(inc.applied).toBe(3);
    expect(inc.skipped).toBe(0);
    const gc = await C.maybeGc(); // 3 条 > 阈值 2 → 截断成功
    expect(gc.gced).toBe(true);
    expect(gc.reason).toBeUndefined();
  });
});
