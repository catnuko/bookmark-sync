import { describe, it, expect } from 'vitest';
import {
  Replica,
  ROOT_NODE_ID,
  ROOT_UUID,
  MENU_UUID,
  TRASH_NODE_ID,
} from '../../src/crdt/index.js';

describe('Replica wrapper', () => {
  it('builds the fixed roots including MENU_UUID (书签菜单)', () => {
    const r = new Replica('R1');
    r.ensureRoots();
    expect(r.getParent(MENU_UUID)).toBe(ROOT_UUID);
    // 菜单根之下可正常创建用户节点
    const m = r.createNode(MENU_UUID, { title: '菜单书签' });
    expect(r.getParent(m)).toBe(MENU_UUID);
    // 只有固定根时仍视为 bare（冷启动保护语义不变）
    const r2 = new Replica('R2');
    expect(r2.isBare()).toBe(true);
  });

  it('creates globally unique node ids (UUIDs)', () => {
    const r = new Replica('R1');
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = r.createNode(ROOT_NODE_ID, {});
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  it('getOps() exports operations in ascending timestamp order', () => {
    const r = new Replica('R1');
    r.createNode(ROOT_NODE_ID, { title: 'a' });
    r.createNode(ROOT_NODE_ID, { title: 'b' });
    r.createNode(ROOT_NODE_ID, { title: 'c' });

    const ops = r.getOps();
    expect(ops.length).toBe(3);
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i - 1].t.counter).toBeLessThan(ops[i].t.counter);
    }
  });

  it('receiveOp does not allocate a local timestamp', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');
    r1.createNode(ROOT_NODE_ID, { title: 'a' });
    r1.createNode(ROOT_NODE_ID, { title: 'b' });
    const ops = r1.getOps();

    const counterBefore = r2.counter;
    for (const op of ops) r2.receiveOp(op);
    // Lamport clock is advanced to the max received counter, but no new
    // local slot is consumed: the next local op gets counter = max+1.
    expect(r2.counter).toBe(ops[ops.length - 1].t.counter);
    expect(counterBefore).toBe(0);
    const newId = r2.createNode(ROOT_NODE_ID, { title: 'local' });
    expect(r2.counter).toBe(ops[ops.length - 1].t.counter + 1);
    expect(r2.getParent(newId)).toBe(ROOT_NODE_ID);
  });

  it('two replicas that exchange ops converge', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');
    const a = r1.createNode(ROOT_NODE_ID, { title: 'a' });
    const b = r1.createNode(a, { title: 'b' });

    for (const op of r1.getOps()) r2.receiveOp(op);

    expect(r2.getParent(a)).toBe(ROOT_NODE_ID);
    expect(r2.getParent(b)).toBe(a);
  });

  it('delete on one replica propagates to the other', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');
    const a = r1.createNode(ROOT_NODE_ID, { title: 'a' });
    for (const op of r1.getOps()) r2.receiveOp(op);

    r1.deleteNode(a);
    for (const op of r1.getOps()) r2.receiveOp(op);

    expect(r2.getParent(a)).toBe(TRASH_NODE_ID);
  });

  it('getChildren returns direct children with metadata', () => {
    const r = new Replica('R1');
    const folder = r.createNode(ROOT_NODE_ID, { title: 'folder' });
    const c1 = r.createNode(folder, { title: 'one' });
    const c2 = r.createNode(folder, { title: 'two' });

    const kids = r.getChildren(folder);
    const ids = kids.map((k) => k.id).sort();
    expect(ids).toEqual([c1, c2].sort());
    expect(kids.find((k) => k.id === c1)?.meta.title).toBe('one');
  });

  it('exportSnapshot/applySnapshot round-trips the visible tree', () => {
    const r = new Replica('R1');
    const folder = r.createNode(ROOT_NODE_ID, { title: 'folder' });
    const c1 = r.createNode(folder, { title: 'one', url: 'https://x' });
    r.moveNode(c1, ROOT_NODE_ID);

    const snap = r.exportSnapshot();
    expect(snap.w).not.toBeNull();

    const r2 = new Replica('R2');
    r2.applySnapshot(snap);
    // 非 bare：包含用户节点
    expect(r2.isBare()).toBe(false);
    expect(r2.getParent(folder)).toBe(ROOT_NODE_ID);
    expect(r2.getParent(c1)).toBe(ROOT_NODE_ID);
    expect(r2.getNodeMeta(c1)?.title).toBe('one');
    expect(r2.getNodeMeta(c1)?.url).toBe('https://x');
  });

  it('applySnapshot sets gcWatermark so old ops are skipped', () => {
    const a = new Replica('A');
    const b = new Replica('B');
    const id = a.createNode(ROOT_NODE_ID, { title: 'x' });
    const snapA = a.exportSnapshot();

    // B 先应用快照（相当于截断后的重建）
    b.applySnapshot(snapA);
    expect(b.getParent(id)).toBe(ROOT_NODE_ID);
    // B 收到被折叠进快照的旧 op → 跳过（不双写、不报错）
    for (const op of a.getOps()) b.receiveOp(op);
    expect(b.getParent(id)).toBe(ROOT_NODE_ID);
    expect(b.getChildren(ROOT_NODE_ID).filter((k) => k.id === id).length).toBe(1);

    // 新 op（快照水位之后）正常应用
    const id2 = a.createNode(ROOT_NODE_ID, { title: 'y' });
    b.receiveOp({ ...a.getOps().at(-1)! });
    expect(b.getParent(id2)).toBe(ROOT_NODE_ID);
  });

  it('local ops after applySnapshot stay strictly above the watermark', () => {
    const a = new Replica('A');
    const b = new Replica('B');
    a.createNode(ROOT_NODE_ID, { title: 'x' });
    b.applySnapshot(a.exportSnapshot());

    // 本地新 op 的 counter 必须 > watermark（保证对端不被误跳过）
    const newId = b.createNode(ROOT_NODE_ID, { title: 'local' });
    const op = b.getOps().at(-1)!;
    expect(op.t.counter).toBeGreaterThan(a.exportSnapshot().w!.counter);
    expect(b.getParent(newId)).toBe(ROOT_NODE_ID);
  });
});
