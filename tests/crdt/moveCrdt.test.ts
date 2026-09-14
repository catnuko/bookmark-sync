import { describe, it, expect } from 'vitest';
import { Replica, ROOT_NODE_ID, TRASH_NODE_ID } from '../../src/crdt/index.js';

describe('Move-CRDT core (Fig.4) — single-replica behaviour', () => {
  it('1. createNode places the new node under the requested parent', () => {
    const r = new Replica('R1');
    const folder = r.createNode(ROOT_NODE_ID, { title: 'work' });
    const child = r.createNode(folder, { title: 'report.pdf' });

    expect(r.getParent(child)).toBe(folder);
    expect(r.getParent(folder)).toBe(ROOT_NODE_ID);
    const kids = r.getChildren(folder);
    expect(kids.map((k) => k.id)).toContain(child);
  });

  it('2. moveNode changes the parent of a node', () => {
    const r = new Replica('R1');
    const a = r.createNode(ROOT_NODE_ID, { title: 'A' });
    const b = r.createNode(ROOT_NODE_ID, { title: 'B' });

    r.moveNode(a, b);
    expect(r.getParent(a)).toBe(b);
    expect(r.getParent(b)).toBe(ROOT_NODE_ID);
  });

  it('3. deleteNode moves the node to trash and removes it from the visible tree', () => {
    const r = new Replica('R1');
    const a = r.createNode(ROOT_NODE_ID, { title: 'A' });
    expect(r.getParent(a)).toBe(ROOT_NODE_ID);

    r.deleteNode(a);
    expect(r.getParent(a)).toBe(TRASH_NODE_ID);

    const visible = r.getVisibleTree();
    // No visible edge should point at `a` as a child of a non-trash parent.
    expect(visible.some((e) => e.child === a && e.parent !== TRASH_NODE_ID)).toBe(false);
  });

  it('4. ring detection: moving a folder under its own descendant is rejected (tree unchanged)', () => {
    const r = new Replica('R1');
    const root = ROOT_NODE_ID;
    const a = r.createNode(root, { title: 'A' });
    const b = r.createNode(a, { title: 'B' });
    const c = r.createNode(b, { title: 'C' });

    // Before: A -> B -> C. Try to move A under C (would create A->B->C->A).
    const parentBefore = r.getParent(a);
    r.moveNode(a, c);
    // do_op rejects: ancestor(tree, c=A, p=C) is true (A is ancestor of C).
    expect(r.getParent(a)).toBe(parentBefore);
    expect(r.getParent(b)).toBe(a);
    expect(r.getParent(c)).toBe(b);
  });

  it('5. moving a node onto itself (c === p) is rejected', () => {
    const r = new Replica('R1');
    const a = r.createNode(ROOT_NODE_ID, { title: 'A' });
    r.moveNode(a, a);
    expect(r.getParent(a)).toBe(ROOT_NODE_ID);
  });

  it('6. metadata LWW: the later-timestamp metadata wins on the same node', () => {
    // Two replicas concurrently update the metadata of the same node.
    // The operation with the larger timestamp must win.
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');

    const a = r1.createNode(ROOT_NODE_ID, { title: 'v1' });
    r2.receiveOp(r1.getOps().find((op) => op.c === a)!);

    // r1 updates title to "v2" (smaller timestamp, R1)
    r1.moveNode(a, ROOT_NODE_ID, { title: 'v2' });
    // r2 updates title to "v3" (larger timestamp, R2 — see below).
    // We force r2's timestamp to be larger by giving it a higher counter
    // via a throwaway local op first, then updating.
    r2.createNode(ROOT_NODE_ID, { title: 'throwaway' }); // bump r2 counter
    r2.moveNode(a, ROOT_NODE_ID, { title: 'v3' });

    // Cross-sync in both directions.
    for (const op of r1.getOps()) r2.receiveOp(op);
    for (const op of r2.getOps()) r1.receiveOp(op);

    // r2's metadata op has the larger (counter, replicaId) -> it wins.
    expect(r1.getNodeMeta(a)?.title).toBe('v3');
    expect(r2.getNodeMeta(a)?.title).toBe('v3');
  });

  it('isAncestor follows the parent chain (true for ancestor, false otherwise)', () => {
    const r = new Replica('R1');
    const a = r.createNode(ROOT_NODE_ID, {});
    const b = r.createNode(a, {});
    const c = r.createNode(b, {});

    expect(r.isAncestor(a, c)).toBe(true);
    expect(r.isAncestor(a, b)).toBe(true);
    expect(r.isAncestor(b, c)).toBe(true);
    expect(r.isAncestor(c, a)).toBe(false);
    expect(r.isAncestor(a, a)).toBe(false); // not reflexive
  });
});
