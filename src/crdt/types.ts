/**
 * Core data types for the Move-CRDT.
 *
 * These mirror the Isabelle/HOL datatypes from Fig.4 of:
 *   Kleppmann, Mulligan, Gomes, Beresford,
 *   "A highly-available move operation for replicated trees",
 *   IEEE TPDS 33(7):1711-1724, 2021.
 *
 * Tree representation (§3.1, Fig.4 line 14):
 *   The tree is NOT stored as parent pointers. It is a set of
 *   (parent, meta, child) triples. We key the set by `child` so that
 *   lookups are O(1); the current tree is a projection of the log.
 */

/** Lamport logical timestamp: (counter, replicaId) gives a total order. */
export interface Timestamp {
  /** Lamport logical clock, monotonically increasing within a replica. */
  counter: number;
  /** Replica unique id, used as tie-break when counters are equal. */
  replicaId: string;
}

/**
 * Arbitrary per-node metadata. LWW by timestamp (§3.5, p.6).
 * A bookmark node would carry { title, url, position (fractional index) }.
 */
export interface Metadata {
  title?: string;
  url?: string;
  /** fractional index used for same-parent ordering (see fractionalIndex.ts). */
  position?: string;
  [key: string]: unknown;
}

/**
 * A single Move operation (Fig.4 lines 1-4).
 * "At time t, attach child c under new parent p with metadata m."
 * The operation does NOT record the old location.
 */
export interface MoveOp {
  t: Timestamp;
  /** new parent node id (or TRASH_NODE_ID to delete, or ROOT_NODE_ID to top-level). */
  p: string;
  /** metadata to attach to c (LWW, larger timestamp wins). */
  m: Metadata;
  /** child node being moved / created / deleted. */
  c: string;
}

/**
 * A record appended to the operation log after do_op (Fig.4 lines 7-12).
 * oldParent === null means c did not previously exist (this op created it).
 */
export interface LogMove {
  t: Timestamp;
  oldParent: { p: string; m: Metadata } | null;
  newParent: string;
  m: Metadata;
  c: string;
}

/** One (parent, meta, child) triple, used for visible-tree projection. */
export interface Edge {
  parent: string;
  meta: Metadata;
  child: string;
}

/**
 * Full CRDT state: (log, tree).
 * - log is ordered by timestamp DESCENDING (newest first), Fig.4 line 14.
 * - tree is the current projection: child -> { parent, meta }.
 */
export interface CrdtState {
  log: LogMove[];
  tree: Map<string, { parent: string; meta: Metadata }>;
}

/** Virtual top-level parent. Not stored in the tree itself. */
export const ROOT_NODE_ID = '__root__';

/** Virtual trash parent (§3.6, p.7): delete == move to this id. */
export const TRASH_NODE_ID = '__trash__';
