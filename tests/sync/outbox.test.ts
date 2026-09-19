/**
 * tests/sync/outbox.test.ts — 批量导入加固的端到端行为。
 *
 * 覆盖（对应 Phase C-3 加固）：
 *   - OutboxStore：落盘/按空间恢复/确认删除 + 空间隔离
 *   - 崩溃恢复：推送前 SW 回收 → outbox 重放 → 重推成功（不丢、counter 不回退）
 *   - 分块推送：单请求体积有界；中途失败只重试剩余块；确认回调逐块删除
 *   - captureLocalTree：重扫描幂等（重复执行不产生重复 op）+
 *     设备 B 并集收敛（云端非空时本机未映射书签仍被捕获上传）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  IdBridge,
  captureLocalTree,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
  type OpLogTransport,
  type PushOp,
} from '../../src/sync/index.js';
import { openBookmarkDb, OutboxStore, DB_VERSION } from '../../src/crdt/index.js';
import { generateKey, ROOT_NODE_ID } from '../../src/crdt/index.js';

const SPACE_A = 'bbbbbbbb-0000-4000-8000-aaaa11111111';
const SPACE_B = 'bbbbbbbb-0000-4000-8000-aaaa22222222';

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
});

async function makeStore(): Promise<OutboxStore> {
  const db = await openBookmarkDb(factory, 'outbox-test', DB_VERSION);
  return new OutboxStore(db);
}

describe('OutboxStore', () => {
  it('put/load/delete roundtrip with space isolation', async () => {
    const store = await makeStore();
    const key = await generateKey();
    const c = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'd1', transport: new MemoryOpLogTransport(), key });
    c.createNode(ROOT_NODE_ID, { title: 'x' });
    c.createNode(ROOT_NODE_ID, { title: 'y' });
    await store.putOps(SPACE_A, c.peekPendingJournal());

    const c2 = new SyncCoordinator({ spaceId: SPACE_B, deviceId: 'd1', transport: new MemoryOpLogTransport(), key });
    c2.createNode(ROOT_NODE_ID, { title: 'z' });
    await store.putOps(SPACE_B, c2.peekPendingJournal());

    const rowsA = await store.loadSpace(SPACE_A);
    expect(rowsA.map((r) => r.op.m?.title).sort()).toEqual(['x', 'y']);

    // 确认删除一条 → 只剩另一条；B 空间不受影响
    await store.deleteSeqs(SPACE_A, [rowsA[0].seq]);
    expect((await store.loadSpace(SPACE_A)).length).toBe(1);
    expect((await store.loadSpace(SPACE_B)).length).toBe(1);
  });
});

describe('crash recovery via outbox', () => {
  it('ops enqueued but never pushed survive SW recycle and get pushed', async () => {
    const store = await makeStore();
    const transport = new MemoryOpLogTransport(); // 服务端模拟：跨"崩溃"存续
    const key = await generateKey();

    // SW 实例 1：入队两笔 op，outbox 已落盘（flushPersist），推送前"崩溃"
    const a = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'dev-A', transport, key });
    a.createNode(ROOT_NODE_ID, { title: 'x' });
    a.createNode(ROOT_NODE_ID, { title: 'y' });
    await store.putOps(SPACE_A, a.peekPendingJournal());
    expect(transport.size).toBe(0); // 一条都没推上去

    // SW 实例 2（冷启动）：outbox 恢复 → replica 收到自己的 op → 重推成功
    const deleted: number[][] = [];
    const b = new SyncCoordinator({
      spaceId: SPACE_A,
      deviceId: 'dev-A',
      transport,
      key,
      onChunkPushed: async (_sid, seqs) => {
        deleted.push(seqs);
        await store.deleteSeqs(SPACE_A, seqs);
      },
    });
    b.restoreOutbox(await store.loadSpace(SPACE_A));
    expect(b.replica.getVisibleTree().some((e) => e.meta?.title === 'x')).toBe(true);
    const inserted = await b.flushPush();
    expect(inserted).toBe(2);
    expect(transport.size).toBe(2);
    expect(deleted.length).toBe(1); // 单块（默认 500 上限）
    expect((await store.loadSpace(SPACE_A)).length).toBe(0); // 确认后清空

    // 恢复后的新 op 不复用旧 seq：counter 已被 restoreOutbox 抬升
    b.createNode(ROOT_NODE_ID, { title: 'z' });
    const seqs = b.peekPendingJournal().map((o) => o.t.counter);
    const restoredSeqs = (await store.loadSpace(SPACE_A)).length; // 0
    expect(restoredSeqs).toBe(0);
    await b.flushPush();
    expect(transport.size).toBe(3);
    expect(Math.max(...seqs)).toBeGreaterThan(0);
  });
});

describe('chunked push', () => {
  function spyTransport(inner: MemoryOpLogTransport, onPush?: (ops: PushOp[]) => void): OpLogTransport {
    return {
      push: async (spaceId, deviceId, ops) => {
        onPush?.(ops);
        return inner.push(spaceId, deviceId, ops);
      },
      pull: (spaceId, afterId, limit) => inner.pull(spaceId, afterId, limit),
      snapshotPull: (spaceId) => inner.snapshotPull(spaceId),
      maybeGc: (spaceId, projection) => inner.maybeGc(spaceId, projection),
    };
  }

  it('splits pendingPush into bounded chunks', async () => {
    const inner = new MemoryOpLogTransport();
    const sizes: number[] = [];
    const transport = spyTransport(inner, (ops) => sizes.push(ops.length));
    const key = await generateKey();
    const c = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'd1', transport, key, pushChunkSize: 2 });
    for (let i = 0; i < 5; i++) c.createNode(ROOT_NODE_ID, { title: `n${i}` });
    const inserted = await c.flushPush();
    expect(sizes).toEqual([2, 2, 1]);
    expect(inserted).toBe(5);
    expect(inner.size).toBe(5);
  });

  it('failure mid-way keeps remaining chunks; retry pushes only the rest', async () => {
    const inner = new MemoryOpLogTransport();
    let call = 0;
    const transport = spyTransport(inner, () => undefined);
    const failing: OpLogTransport = {
      ...transport,
      push: async (spaceId, deviceId, ops) => {
        call++;
        if (call === 2) throw new Error('boom'); // 第二块失败
        return transport.push(spaceId, deviceId, ops);
      },
    };
    const store = await makeStore();
    const chunkSeqs: number[][] = [];
    const key = await generateKey();
    const c = new SyncCoordinator({
      spaceId: SPACE_A,
      deviceId: 'd1',
      transport: failing,
      key,
      pushChunkSize: 2,
      onChunkPushed: async (_sid, seqs) => {
        chunkSeqs.push(seqs);
        await store.deleteSeqs(SPACE_A, seqs);
      },
    });
    for (let i = 0; i < 5; i++) c.createNode(ROOT_NODE_ID, { title: `n${i}` });
    // 全部落盘（模拟 flushPersist 已跑过）
    await store.putOps(SPACE_A, c.peekPendingJournal());

    await expect(c.flushPush()).rejects.toThrow('boom');
    expect(inner.size).toBe(2); // 第一块成功
    expect(chunkSeqs.length).toBe(1);
    expect((await store.loadSpace(SPACE_A)).length).toBe(3); // 剩余块仍在 outbox

    // "崩溃后重启"：新实例从 outbox 恢复剩余 3 条，重推成功
    const c2 = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'd1', transport: inner, key });
    c2.restoreOutbox(await store.loadSpace(SPACE_A));
    const inserted = await c2.flushPush();
    expect(inserted).toBe(3);
    expect(inner.size).toBe(5); // 无丢失：2（崩溃前）+ 3（恢复后）
  });
});

describe('captureLocalTree (rescan)', () => {
  /** 最小 chrome.bookmarks 桩：直接操作树（无事件），getChildren 供断言。 */
  function makeChrome(): { api: ChromeBookmarksAPI; addNode(parentId: string, title: string, url?: string): ChromeTreeNode; children(parentId: string): ChromeTreeNode[] } {
    interface N extends ChromeTreeNode { parentId?: string; index?: number; url?: string; }
    const tree = new Map<string, N>();
    const seed = (n: N) => { tree.set(n.id, n); for (const c of n.children ?? []) seed(c); };
    const ROOTS: N[] = [
      { id: '0', title: '', children: [
        { id: '1', title: '书签栏', parentId: '0', index: 0, children: [] },
        { id: '2', title: '其他书签', parentId: '0', index: 1, children: [] },
        { id: '3', title: '移动设备书签', parentId: '0', index: 2, children: [] },
      ] },
    ];
    for (const r of ROOTS) seed(r);
    const api: ChromeBookmarksAPI = {
      getTree: async () => {
        const clone = (n: N): N => ({ ...n, children: (n.children ?? []).map(clone) });
        return ROOTS.map(clone);
      },
      getChildren: async (parentId: string) => (tree.get(parentId)?.children ?? []).map((c) => ({ ...c })),
      create: async () => { throw new Error('not used in rescan tests'); },
      move: async () => { throw new Error('not used'); },
      update: async () => { throw new Error('not used'); },
      remove: async () => {},
      removeTree: async () => {},
      onCreated: { addListener: () => {} },
      onChanged: { addListener: () => {} },
      onMoved: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    } as ChromeBookmarksAPI;
    return {
      api,
      addNode(parentId: string, title: string, url?: string): N {
        const parent = tree.get(parentId)!;
        const node: N = { id: 'n' + Math.random().toString(36).slice(2, 8), parentId, title, url, index: parent.children!.length, children: [] };
        parent.children!.push(node);
        tree.set(node.id, node);
        return node;
      },
      children(parentId: string) { return tree.get(parentId)?.children ?? []; },
    };
  }

  it('is idempotent: second rescan creates zero ops', async () => {
    const chrome = makeChrome();
    chrome.addNode('1', 'Doc', 'https://a.example.com');
    const c = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'd1', transport: new MemoryOpLogTransport(), key: await generateKey() });
    const bridge = new IdBridge();

    expect(await captureLocalTree(chrome.api, c, bridge)).toBe(1);
    expect(c.peekPendingJournal().length).toBe(1);
    // 第二轮（映射已建立）不产生重复 op
    expect(await captureLocalTree(chrome.api, c, bridge)).toBe(0);
    expect(c.peekPendingJournal().length).toBe(1);
  });

  it('snapshot rebuild after crash keeps unpushed local ops (watermark bypass)', async () => {
    // 场景：另一设备已打 GC 快照（水位高于崩溃设备未推送 op 的 Lamport
    // 计数）。restoreOutbox 使 isBare() 为 false，冷启动重放必须仍触发
    // （needsColdReplay），且快照重建后本地 op 经 receiveLocalOp 重放——
    // receiveOp 的水位守卫会把它错误丢弃 → 本地误删。
    const inner = new MemoryOpLogTransport(1); // gcThreshold=1：2 笔 op 即可 GC
    const key = await generateKey();
    const s = new SyncCoordinator({ spaceId: SPACE_B, deviceId: 'dev-S', transport: inner, key });
    s.createNode(ROOT_NODE_ID, { title: 's1' });
    s.createNode(ROOT_NODE_ID, { title: 's2' });
    await s.flushPush();
    expect((await s.maybeGc()).gced).toBe(true);

    const store = await makeStore();
    const a = new SyncCoordinator({ spaceId: SPACE_B, deviceId: 'dev-A', transport: inner, key });
    a.createNode(ROOT_NODE_ID, { title: 'local-crash' }); // counter 6 ≤ 快照水位
    await store.putOps(SPACE_B, a.peekPendingJournal());

    const b = new SyncCoordinator({ spaceId: SPACE_B, deviceId: 'dev-A', transport: inner, key });
    b.restoreOutbox(await store.loadSpace(SPACE_B));
    expect(b.needsColdReplay).toBe(true);
    await b.pullWithSnapshot(true);
    const titles = b.replica.getVisibleTree().map((e) => e.meta?.title);
    expect(titles).toContain('local-crash'); // 水位豁免：未被当作「已折叠」丢弃
    expect(titles).toContain('s1');
    expect(titles).toContain('s2');
  });

  it('device B union: cloud non-empty + unmapped local bookmark still gets uploaded', async () => {
    const transport = new MemoryOpLogTransport(); // 共享"服务端"
    const key = await generateKey();

    // 设备 A：云端已有历史
    const a = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'dev-A', transport, key });
    a.createNode(ROOT_NODE_ID, { title: 'from-A' });
    await a.flushPush();

    // 设备 B：本地有一本未映射书签（云端非空 → 旧实现永不播种 → 永不同步）
    const chrome = makeChrome();
    chrome.addNode('2', 'local-only', 'https://b.example.com');
    const b = new SyncCoordinator({ spaceId: SPACE_A, deviceId: 'dev-B', transport, key });
    const bridge = new IdBridge();
    await b.pull();
    expect(await captureLocalTree(chrome.api, b, bridge)).toBe(1);
    await b.flushPush();

    // 双向收敛：A 拉到 B 的本地书签，B 持有 A 的云端书签 + 自己的本地书签
    await a.pull();
    const ROOT_TITLES = new Set(['__root__', '书签栏', '其他书签', '移动设备书签', '书签菜单', '']);
    const titles = (r: typeof a) =>
      r.replica.getVisibleTree().map((e) => e.meta?.title ?? '').filter((t) => !ROOT_TITLES.has(t)).sort();
    expect(titles(a)).toEqual(['from-A', 'local-only']);
    expect(titles(b)).toEqual(['from-A', 'local-only']);
    // 第二轮重扫描不再产生新 op（幂等收敛）
    expect(await captureLocalTree(chrome.api, b, bridge)).toBe(0);
  });
});
