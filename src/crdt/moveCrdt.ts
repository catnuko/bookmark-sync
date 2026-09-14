import type { CrdtState, LogMove, Metadata, MoveOp, Timestamp } from './types.js';
import { cmpTimestamp } from './timestamp.js';
import { ancestor, get_parent } from './tree.js';

/**
 * Pure functions implementing the Move-CRDT core (§3.3-3.4, Fig.4 lines 22-46).
 *
 * Conventions:
 *  - The tree Map is treated as immutable here: each function that changes
 *    it returns a NEW Map. This keeps undo/redo simple and avoids sharing
 *    mutable state across recursive apply_op calls.
 *  - log is ordered by timestamp DESCENDING (head = newest).
 */

/** Result of do_op: the LogMove to append, and the (possibly unchanged) tree. */
export interface DoOpResult {
  logMove: LogMove;
  tree: CrdtState['tree'];
}

/**
 * do_op (Fig.4 lines 26-29): actually apply one Move to a tree projection.
 *
 *   do_op (Move t neup m c, tree) =
 *     (LogMove t (get_parent tree c) neup m c,
 *      if ancestor tree c neup ∨ c = neup then tree
 *      else {(p',m',c') ∈ tree. c' ≠ c} ∪ {(neup, m, c)})
 *
 * Note: even when the operation is REJECTED (would create a cycle, or
 * c === neup), we still return a LogMove recording oldParent. The tree
 * is unchanged. Rejected ops must still appear in the log so that
 * undo/redo bookkeeping stays consistent across replicas.
 */
export function do_op(op: MoveOp, tree: CrdtState['tree']): DoOpResult {
  const oldParent = get_parent(tree, op.c);

  // §3.3, Fig.4 line 28: refuse if moving c under its own descendant
  // (would create a cycle) or moving c onto itself.
  const wouldCycle = ancestor(tree, op.c, op.p) || op.c === op.p;

  if (wouldCycle) {
    const logMove: LogMove = {
      t: op.t,
      oldParent,
      newParent: op.p,
      m: op.m,
      c: op.c,
    };
    return { logMove, tree };
  }

  // Remove all edges whose child is c, then add the new edge.
  // Because the tree Map is keyed by child, there is at most one such edge,
  // but we write it set-style to match the Isabelle definition.
  const newTree = new Map(tree);
  newTree.delete(op.c);
  newTree.set(op.c, { parent: op.p, meta: op.m });

  const logMove: LogMove = {
    t: op.t,
    oldParent,
    newParent: op.p,
    m: op.m,
    c: op.c,
  };
  return { logMove, tree: newTree };
}

/**
 * undo_op (Fig.4 lines 31-33): revert a previously applied LogMove.
 *
 *   undo_op (LogMove t None neup m c, tree)
 *     = {(p',m',c') ∈ tree. c' ≠ c}
 *   undo_op (LogMove t (Some oldm) neup m c, tree)
 *     = {(p',m',c') ∈ tree. c' ≠ c} ∪ {oldm, c}
 *
 * i.e. drop c's current edge and, if c existed before this op, restore
 * its old (parent, meta). If oldParent === null (this op created c),
 * dropping the edge removes c entirely.
 */
export function undo_op(logMove: LogMove, tree: CrdtState['tree']): CrdtState['tree'] {
  const newTree = new Map(tree);
  newTree.delete(logMove.c);
  if (logMove.oldParent !== null) {
    newTree.set(logMove.c, {
      parent: logMove.oldParent.p,
      meta: logMove.oldParent.m,
    });
  }
  return newTree;
}

/**
 * redo_op (Fig.4 lines 35-36): re-apply a LogMove after an undo.
 *
 * Reconstruct the original MoveOp(t, newParent, m, c), run do_op, and
 * prepend the freshly produced LogMove to the log. The new LogMove may
 * record a DIFFERENT oldParent than the original (because intervening
 * ops have changed the tree); that is correct and intended — see §3.4.
 */
export function redo_op(logMove: LogMove, state: CrdtState): CrdtState {
  const op: MoveOp = {
    t: logMove.t,
    p: logMove.newParent,
    m: logMove.m,
    c: logMove.c,
  };
  const { logMove: newLogMove, tree: newTree } = do_op(op, state.tree);
  return { log: [newLogMove, ...state.log], tree: newTree };
}

/**
 * apply_op (Fig.4 lines 38-46): the core entry point, handles out-of-order
 * arrival by reducing to "as if applied in increasing timestamp order".
 *
 *   apply_op op1 ([], tree1) = let (op2, tree2) = do_op op1 tree1 in (op2 #[], tree2)
 *   | apply_op op1 (Logop # ops, tree1) =
 *       if move_time op1 < log_time Logop
 *       then redo_op Logop (apply_op op1 (ops, undo_op (Logop, tree1)))
 *       else let (op2, tree2) = do_op op1 tree1 in (op2 # (Logop # ops), tree2)
 *
 * §3.4, p.6: "the state of the tree is as if all operations had been applied
 * using do_op in increasing timestamp order, regardless of the order in
 * which they were actually applied."
 */
export function apply_op(op: MoveOp, state: CrdtState): CrdtState {
  if (state.log.length === 0) {
    const { logMove, tree } = do_op(op, state.tree);
    return { log: [logMove], tree };
  }

  const head = state.log[0];
  if (cmpTimestamp(op.t, head.t) < 0) {
    // op is OLDER than the newest log entry: undo the head, recursively
    // apply op to the remaining (older) log, then redo the head.
    const undoneTree = undo_op(head, state.tree);
    const intermediate: CrdtState = apply_op(op, {
      log: state.log.slice(1),
      tree: undoneTree,
    });
    return redo_op(head, intermediate);
  }

  // op is newer than (or equal to — but timestamps are unique) the head:
  // apply directly and prepend.
  const { logMove, tree } = do_op(op, state.tree);
  return { log: [logMove, ...state.log], tree };
}

/** Build an empty CRDT state. */
export function emptyState(): CrdtState {
  return { log: [], tree: new Map() };
}

/** Helper: reconstruct a MoveOp from a LogMove (for export / testing). */
export function logMoveToOp(lm: LogMove): MoveOp {
  return { t: lm.t, p: lm.newParent, m: lm.m, c: lm.c };
}

/** Re-export for callers that need the Timestamp type from this module. */
export type { CrdtState, LogMove, Metadata, MoveOp, Timestamp };
