import { describe, it, expect } from 'vitest';
import { Replica, ROOT_NODE_ID, TRASH_NODE_ID } from '../../src/crdt/index.js';

describe('Replica wrapper', () => {
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
});
