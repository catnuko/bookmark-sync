import type { CrdtState, Metadata } from './types.js';

/**
 * Tree-level helpers (Fig.4 lines 15-25).
 *
 * The tree is a Map keyed by child id: child -> { parent, meta }.
 * This is equivalent to the Isabelle set (parent, meta, child), but
 * keyed by child so lookups are O(1).
 */

type Tree = CrdtState['tree'];

/**
 * get_parent(tree, child) (Fig.4 lines 15-20).
 * Returns Some (parent, meta) if child is in the tree, else None.
 */
export function get_parent(
  tree: Tree,
  child: string,
): { p: string; m: Metadata } | null {
  const entry = tree.get(child);
  if (!entry) return null;
  return { p: entry.parent, m: entry.meta };
}

/**
 * ancestor(tree, anc, desc) (Fig.4 lines 22-25).
 *
 * True iff `anc` is a (reflexive? no — strictly above) ancestor of `desc`,
 * i.e. walking parent pointers upward from `desc` reaches `anc`.
 *
 * We walk the parent chain. As a safety net against any bug that would
 * produce a cycle (the CRDT is proven cycle-free, but defensive walks
 * must not infinite-loop), we bound the walk to the number of nodes in
 * the tree. The paper's inductive definition does not need this bound
 * because the tree is acyclic by construction (Move_Acyclic.thy).
 */
export function ancestor(tree: Tree, anc: string, desc: string): boolean {
  // Walk upward from `desc`. If we ever reach `anc` (without it being
  // `desc` itself — `anc === desc` is NOT considered an ancestor here;
  // do_op separately checks c === p for the "move to self" case).
  let cur: string | undefined = desc;
  const bound = tree.size + 1;
  let steps = 0;
  while (cur !== undefined && steps < bound) {
    const entry = tree.get(cur);
    if (!entry) return false; // reached root / trash / unknown: no parent
    if (entry.parent === anc) return true;
    cur = entry.parent;
    steps++;
  }
  return false;
}
