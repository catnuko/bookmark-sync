import { describe, it, expect } from 'vitest';
import { Replica, ROOT_NODE_ID, TRASH_NODE_ID, cmpTimestamp, type MoveOp } from '../../src/crdt/index.js';

/**
 * Convergence tests (§4, p.8): apply_ops_commutes, apply_ops_acyclic,
 * apply_ops_unique_parent. These are the most important tests.
 */

/** Compare two replicas' tree projections for equality. */
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

/** Assert the tree has no cycles: walk up from every node, revisit = cycle. */
function assertAcyclic(r: Replica): void {
  const tree = r.state.tree;
  for (const child of tree.keys()) {
    const seen = new Set<string>();
    let cur: string | undefined = child;
    while (cur !== undefined) {
      if (seen.has(cur)) {
        throw new Error(`cycle detected at node ${cur} (starting from ${child})`);
      }
      seen.add(cur);
      const entry = tree.get(cur);
      if (!entry) break;
      if (entry.parent === cur) {
        throw new Error(`self-loop at ${cur}`);
      }
      cur = entry.parent;
    }
  }
}

/** Replay a list of ops in ascending-timestamp order on a fresh replica. */
function canonicalReplay(ops: MoveOp[], replicaId: string): Replica {
  const r = new Replica(replicaId);
  const sorted = [...ops].sort((a, b) => cmpTimestamp(a.t, b.t));
  for (const op of sorted) r.receiveOp(op);
  return r;
}

describe('convergence', () => {
  it('1. concurrent A->B and B->A moves converge, stay acyclic (Fig.2 cyclic case)', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');

    // Set up: A and B both under root.
    const A = r1.createNode(ROOT_NODE_ID, { title: 'A' });
    const B = r1.createNode(ROOT_NODE_ID, { title: 'B' });
    for (const op of r1.getOps()) r2.receiveOp(op);

    // r1 moves A -> B (smaller timestamp: R1 tie-break wins).
    r1.moveNode(A, B);
    // r2 moves B -> A (larger timestamp).
    r2.moveNode(B, A);

    // Cross-sync.
    const ops1 = r1.getOps();
    const ops2 = r2.getOps();
    for (const op of ops2) r1.receiveOp(op);
    for (const op of ops1) r2.receiveOp(op);

    // Both replicas must agree.
    expect(treesEqual(r1, r2)).toBe(true);
    assertAcyclic(r1);
    assertAcyclic(r2);

    // Canonical-order trace:
    //   t_small = Move(A->B)   applied first: root->B, B->A
    //   t_large = Move(B->A)   applied second: do_op detects B is ancestor of A -> rejected.
    // => final: A is under B. The larger-timestamp move cannot take effect
    //    because doing so would create a cycle; this is exactly the paper's
    //    ring-detection arbitration (§3.3, Fig.4 line 28; Fig.2 discussion).
    expect(r1.getParent(A)).toBe(B);
    expect(r1.getParent(B)).toBe(ROOT_NODE_ID);
  });

  it('2. moving a concurrently-deleted node: larger timestamp wins (move beats delete here)', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');

    const X = r1.createNode(ROOT_NODE_ID, { title: 'X' });
    const F = r1.createNode(ROOT_NODE_ID, { title: 'F' });
    for (const op of r1.getOps()) r2.receiveOp(op);

    // r1 deletes X (smaller timestamp, R1).
    r1.deleteNode(X);
    // r2 moves X into F (larger timestamp, R2).
    r2.moveNode(X, F);

    const ops1 = r1.getOps();
    const ops2 = r2.getOps();
    for (const op of ops2) r1.receiveOp(op);
    for (const op of ops1) r2.receiveOp(op);

    expect(treesEqual(r1, r2)).toBe(true);
    assertAcyclic(r1);

    // Canonical order: delete (small) then move (large). The move is not
    // cyclic (X is not an ancestor of F), so it re-attaches X under F.
    expect(r1.getParent(X)).toBe(F);
    expect(r2.getParent(X)).toBe(F);
  });

  it('2b. same scenario with delete winning: delete has larger timestamp -> X stays in trash', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');

    const X = r1.createNode(ROOT_NODE_ID, { title: 'X' });
    const F = r1.createNode(ROOT_NODE_ID, { title: 'F' });
    for (const op of r1.getOps()) r2.receiveOp(op);

    // Make r1's counter larger than r2's before the competing ops.
    // r2 moves X->F first (small), r1 deletes X second (large).
    r2.moveNode(X, F);
    // Bump r1 above r2's counter via a throwaway op, then delete.
    r1.createNode(ROOT_NODE_ID, { title: 'bump' });
    r1.deleteNode(X);

    const ops1 = r1.getOps();
    const ops2 = r2.getOps();
    for (const op of ops2) r1.receiveOp(op);
    for (const op of ops1) r2.receiveOp(op);

    expect(treesEqual(r1, r2)).toBe(true);
    // Canonical order: move (small) then delete (large). Delete re-attaches
    // X under trash, overriding the move.
    expect(r1.getParent(X)).toBe(TRASH_NODE_ID);
    expect(r2.getParent(X)).toBe(TRASH_NODE_ID);
  });

  it('3. two devices edit offline then merge: full convergence', () => {
    const r1 = new Replica('R1');
    const r2 = new Replica('R2');

    // Seed a shared root structure.
    const shared = r1.createNode(ROOT_NODE_ID, { title: 'shared-folder' });
    for (const op of r1.getOps()) r2.receiveOp(op);

    // r1 offline: create 5 nodes, move 3 of them.
    const r1nodes: string[] = [shared];
    for (let i = 0; i < 5; i++) {
      const parent = r1nodes[Math.floor(Math.random() * r1nodes.length)];
      r1nodes.push(r1.createNode(parent, { title: `r1-${i}` }));
    }
    for (let i = 0; i < 3; i++) {
      const victim = r1nodes[1 + i];
      const newParent = r1nodes[Math.floor(Math.random() * r1nodes.length)];
      r1.moveNode(victim, newParent);
    }

    // r2 offline: create 4 nodes, move 2.
    const r2nodes: string[] = [shared];
    for (let i = 0; i < 4; i++) {
      const parent = r2nodes[Math.floor(Math.random() * r2nodes.length)];
      r2nodes.push(r2.createNode(parent, { title: `r2-${i}` }));
    }
    for (let i = 0; i < 2; i++) {
      const victim = r2nodes[1 + i];
      const newParent = r2nodes[Math.floor(Math.random() * r2nodes.length)];
      r2.moveNode(victim, newParent);
    }

    // Merge both ways.
    for (const op of r2.getOps()) r1.receiveOp(op);
    for (const op of r1.getOps()) r2.receiveOp(op);

    expect(treesEqual(r1, r2)).toBe(true);
    assertAcyclic(r1);
    assertAcyclic(r2);

    // Cross-check against canonical replay.
    const allOps = [...r1.getOps()];
    const canonical = canonicalReplay(allOps, 'CANON');
    expect(treesEqual(r1, canonical)).toBe(true);
  });

  it('4. same operation set applied in different orders converges', () => {
    // r1 generates a deterministic batch of ops.
    const source = new Replica('SRC');
    const root = ROOT_NODE_ID;
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const parent = ids.length
        ? ids[Math.floor(Math.random() * ids.length)]
        : root;
      ids.push(source.createNode(parent, { title: `n${i}` }));
    }
    for (let i = 0; i < 10; i++) {
      const victim = ids[Math.floor(Math.random() * ids.length)];
      const newParent = ids[Math.floor(Math.random() * ids.length)];
      source.moveNode(victim, newParent);
    }
    for (let i = 0; i < 5; i++) {
      source.deleteNode(ids[Math.floor(Math.random() * ids.length)]);
    }

    const ops = source.getOps();

    // Apply in forward order to rA, shuffled order to rB.
    const rA = new Replica('A');
    for (const op of ops) rA.receiveOp(op);

    const rB = new Replica('B');
    const shuffled = [...ops].reverse(); // a different, deterministic order
    for (const op of shuffled) rB.receiveOp(op);

    expect(treesEqual(rA, rB)).toBe(true);
    assertAcyclic(rA);
    assertAcyclic(rB);
  });

  it('5. fuzzy test: 200 rounds of random op sets, two replicas in different orders converge, acyclic', () => {
    // Seeded PRNG (mulberry32) for reproducibility.
    function mulberry32(seed: number) {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(0x0c0ffee);

    for (let round = 0; round < 200; round++) {
      const source = new Replica(`SRC-${round}`);
      const knownIds: string[] = [ROOT_NODE_ID];
      const nOps = 10 + Math.floor(rand() * 21); // 10..30

      for (let i = 0; i < nOps; i++) {
        const roll = rand();
        if (roll < 0.5 || knownIds.length === 1) {
          // create
          const parent = knownIds[1 + Math.floor(rand() * (knownIds.length - 1))] ?? ROOT_NODE_ID;
          knownIds.push(source.createNode(parent, { title: `n-${round}-${i}` }));
        } else if (roll < 0.85) {
          // move
          const victim = knownIds[1 + Math.floor(rand() * (knownIds.length - 1))];
          const newParent = knownIds[Math.floor(rand() * knownIds.length)];
          if (victim && newParent) source.moveNode(victim, newParent);
        } else {
          // delete
          const victim = knownIds[1 + Math.floor(rand() * (knownIds.length - 1))];
          if (victim) source.deleteNode(victim);
        }
      }

      const ops = source.getOps();

      // rX: forward order.
      const rX = new Replica('X');
      for (const op of ops) rX.receiveOp(op);

      // rY: reverse order (a different deterministic permutation).
      const rY = new Replica('Y');
      for (let i = ops.length - 1; i >= 0; i--) rY.receiveOp(ops[i]);

      expect(treesEqual(rX, rY)).toBe(true);
      assertAcyclic(rX);
      assertAcyclic(rY);

      // Also cross-check against canonical replay.
      const canonical = canonicalReplay(ops, 'CANON');
      expect(treesEqual(rX, canonical)).toBe(true);
    }
  });
});
