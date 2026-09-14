// Browser/Node-neutral UUID: WebCrypto randomUUID exists in Chrome MV3 and
// Node 19+. We deliberately avoid `node:crypto` so the same code bundles for
// the extension service worker.
const randomUUID = (): string => globalThis.crypto.randomUUID();

import type { CrdtState, Edge, Metadata, MoveOp, Timestamp } from './types.js';
import { ROOT_NODE_ID, TRASH_NODE_ID } from './types.js';
import { apply_op, emptyState, logMoveToOp } from './moveCrdt.js';
import { ancestor } from './tree.js';
import { cmpTimestamp } from './timestamp.js';
import {
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
} from './storage/index.js';

/**
 * Fixed replicaId used for the deterministic root-structure ops. Every device
 * builds the same roots with the same timestamps, so the root prefix of the
 * op log is identical across replicas and never needs to be synced.
 */
const ROOT_REPLICA_ID = '00000000-0000-4000-8000-00000000dead';

/**
 * A single replica of the Move-CRDT (§5.1, p.9).
 *
 * Local operations bump the logical clock; remote operations do not.
 * The Lamport clock rule (set counter = max(local, remote.counter) on
 * receive) is applied so that subsequent local operations always get a
 * timestamp greater than any previously received remote op. This is the
 * standard Lamport clock and does not affect convergence (which only
 * requires a unique total order on timestamps).
 *
 * TODO(design): moveNode(nodeId, parentId, meta?) — when `meta` is omitted
 * we carry the node's CURRENT local metadata into the MoveOp. Rationale:
 * the paper's Move always carries metadata, so a pure "reparent" must still
 * declare some metadata; preserving the locally-known value makes a move
 * not clobber metadata. Under concurrency the timestamp still decides
 * LWW, so this is safe, but it means a stale metadata snapshot travels
 * with a move. If an application wants metadata-only updates it should
 * call moveNode(id, getParent(id), newMeta) explicitly.
 */
export class Replica {
  readonly replicaId: string;
  counter: number;
  state: CrdtState;

  /**
   * Phase 4 GC watermark. When set (after applySnapshot), any received op
   * with t <= watermark is skipped — its effect is already folded into the
   * snapshot tree. This lets a truncated replica safely keep receiving old
   * history from un-truncated peers without double-applying it.
   */
  gcWatermark: Timestamp | null = null;

  /**
   * Phase 4 ancestor cache. Memoizes ancestor() results; the cache is
   * invalidated (by bumping `treeVersion`) on every mutation. The pure
   * do_op path still calls tree.ancestor directly (unaffected).
   */
  private treeVersion = 0;
  private ancestorCache: Map<string, boolean> = new Map();

  constructor(replicaId: string) {
    this.replicaId = replicaId;
    this.counter = 0;
    this.state = emptyState();
  }

  /**
   * Build the fixed root structure (ROOT_NODE_ID → ROOT_UUID → bar/other/mobile)
   * with deterministic timestamps. Idempotent; called once per replica.
   *
   * These ops are intentionally NOT pushed to the server: every device
   * constructs the same roots locally (same ids, same timestamps), so they
   * never need to be synced. User bookmarks hang off BOOKMARKS_BAR_UUID etc.,
   * which makes getVisibleTree() (BFS from ROOT_NODE_ID) see the whole tree.
   */
  ensureRoots(): void {
    if (this.state.tree.has(ROOT_UUID)) return;
    const ts = (counter: number): Timestamp => ({ counter, replicaId: ROOT_REPLICA_ID });
    const roots: Array<[string, string, Metadata]> = [
      [ROOT_UUID, ROOT_NODE_ID, { title: '__root__' }],
      [BOOKMARKS_BAR_UUID, ROOT_UUID, { title: '书签栏' }],
      [OTHER_BOOKMARKS_UUID, ROOT_UUID, { title: '其他书签' }],
      [MOBILE_UUID, ROOT_UUID, { title: '移动设备书签' }],
    ];
    roots.forEach(([id, parent, meta], i) => {
      const op: MoveOp = { t: ts(i + 1), p: parent, m: meta, c: id };
      this.state = apply_op(op, this.state);
    });
    // Roots occupy counters 1..4; keep local counters above them.
    this.counter = Math.max(this.counter, roots.length);
    this.bumpVersion();
  }

  /** Mark the tree dirty (call after any mutation that changes edges). */
  private bumpVersion(): void {
    this.treeVersion++;
    this.ancestorCache.clear();
  }

  /** Allocate a fresh timestamp for a local operation. */
  private nextTimestamp() {
    this.counter += 1;
    return { counter: this.counter, replicaId: this.replicaId };
  }

  /**
   * Create a new node under `parentId` with `meta`.
   * Creation is modelled as Move(newId -> parentId) (§3.1, p.4).
   * Returns the new node's globally-unique id.
   */
  createNode(parentId: string, meta: Metadata): string {
    const newId = randomUUID();
    const op: MoveOp = {
      t: this.nextTimestamp(),
      p: parentId,
      m: meta,
      c: newId,
    };
    this.state = apply_op(op, this.state);
    this.bumpVersion();
    return newId;
  }

  /**
   * Create a new node with an EXPLICIT id under `parentId` with `meta`.
   *
   * Phase 1 extension (does not change any Phase 0 method): used by the
   * chrome.bookmarks adapter. Chrome already assigns its own node id when
   * the user creates a bookmark; we map that chromeId to a stable UUID
   * (see src/extension/idMapping.ts) and feed that UUID here, so the CRDT
   * node id is the mapped UUID rather than a freshly random one. This keeps
   * the CRDT id in lock-step with the Chrome id across sessions.
   *
   * Returns `explicitId` for convenience / symmetry with createNode.
   */
  createNodeWithId(explicitId: string, parentId: string, meta: Metadata): string {
    const op: MoveOp = {
      t: this.nextTimestamp(),
      p: parentId,
      m: meta,
      c: explicitId,
    };
    this.state = apply_op(op, this.state);
    this.bumpVersion();
    return explicitId;
  }

  /**
   * Move `nodeId` under `newParentId`. If `meta` is omitted, the node's
   * current metadata is preserved in the MoveOp (see class TODO).
   */
  moveNode(nodeId: string, newParentId: string, meta?: Metadata): void {
    const current = this.state.tree.get(nodeId);
    const m = meta ?? current?.meta ?? {};
    const op: MoveOp = {
      t: this.nextTimestamp(),
      p: newParentId,
      m,
      c: nodeId,
    };
    this.state = apply_op(op, this.state);
    this.bumpVersion();
  }

  /**
   * Delete `nodeId`: modelled as moving it under TRASH_NODE_ID (§3.6, p.7).
   * Children are NOT recursively deleted — they remain reachable from the
   * deleted node, exactly as the paper specifies.
   */
  deleteNode(nodeId: string): void {
    const current = this.state.tree.get(nodeId);
    const m = current?.meta ?? {};
    const op: MoveOp = {
      t: this.nextTimestamp(),
      p: TRASH_NODE_ID,
      m,
      c: nodeId,
    };
    this.state = apply_op(op, this.state);
    this.bumpVersion();
  }

  /**
   * Apply a remote operation. Does NOT allocate a local timestamp, but
   * does advance the local Lamport counter so future local ops stay ahead.
   *
   * Phase 4 GC: if a snapshot watermark is set, ops with t <= watermark are
   * skipped (already folded into the snapshot tree). Only strictly-newer
   * ops are applied.
   */
  receiveOp(op: MoveOp): void {
    if (this.gcWatermark && cmpTimestamp(op.t, this.gcWatermark) <= 0) {
      return; // already represented by the snapshot
    }
    if (op.t.counter > this.counter) {
      this.counter = op.t.counter;
    }
    this.state = apply_op(op, this.state);
    this.bumpVersion();
  }

  /**
   * Export all known operations sorted by timestamp ASCENDING, suitable
   * for transmission to a peer. The log is descending, so we reverse and
   * project each LogMove back into a MoveOp.
   */
  getOps(): MoveOp[] {
    return [...this.state.log]
      .sort((a, b) => cmpTimestamp(a.t, b.t))
      .map(logMoveToOp);
  }

  /** Current parent of `childId`, or null if the node is unknown. */
  getParent(childId: string): string | null {
    return this.state.tree.get(childId)?.parent ?? null;
  }

  /** Children of `parentId`, with their current metadata. */
  getChildren(parentId: string): Array<{ id: string; meta: Metadata }> {
    const out: Array<{ id: string; meta: Metadata }> = [];
    for (const [child, { parent, meta }] of this.state.tree) {
      if (parent === parentId) out.push({ id: child, meta });
    }
    return out;
  }

  /** Current metadata of a node, or null if unknown. */
  getNodeMeta(nodeId: string): Metadata | null {
    return this.state.tree.get(nodeId)?.meta ?? null;
  }

  /**
   * Is `anc` an ancestor of `desc` in the current tree?
   *
   * Phase 4: results are memoized and invalidated on the next tree mutation.
   * The pure CRDT path (do_op) still calls tree.ancestor directly and is
   * unaffected.
   */
  isAncestor(anc: string, desc: string): boolean {
    const key = `${anc}||${desc}`;
    const cached = this.ancestorCache.get(key);
    if (cached !== undefined) return cached;
    const result = ancestor(this.state.tree, anc, desc);
    this.ancestorCache.set(key, result);
    return result;
  }

  /**
   * Visible edges: every edge reachable from ROOT_NODE_ID (BFS).
   *
   * Phase 4 (was the Phase 0 TODO): previously this only dropped edges whose
   * direct parent === TRASH_NODE_ID, so children of a trashed folder were
   * still returned even though they are unreachable from root. Now we walk
   * down from ROOT and only return nodes actually reachable. This also
   * excludes any node that has been moved under a trashed folder, transitively.
   */
  getVisibleTree(): Edge[] {
    // Build a children index for BFS.
    const children: Map<string, string[]> = new Map();
    for (const [child, { parent }] of this.state.tree) {
      const arr = children.get(parent);
      if (arr) arr.push(child);
      else children.set(parent, [child]);
    }

    const visible = new Set<string>();
    const queue: string[] = [ROOT_NODE_ID];
    while (queue.length > 0) {
      const cur = queue.pop()!;
      const kids = children.get(cur);
      if (!kids) continue;
      for (const k of kids) {
        if (visible.has(k)) continue;
        visible.add(k);
        queue.push(k);
      }
    }

    const out: Edge[] = [];
    for (const child of visible) {
      const entry = this.state.tree.get(child)!;
      out.push({ parent: entry.parent, meta: entry.meta, child });
    }
    return out;
  }

  /**
   * True if the visible tree contains no user nodes (only the fixed roots).
   *
   * This is the "cold-start" marker: the MV3 service worker is terminated after
   * ~30s idle and rebuilt in memory on wake, so a freshly constructed replica
   * has only the fixed roots even though cloud history exists. reverseApply
   * must NOT trust a bare replica for deletions (it would wipe the local tree);
   * runSync uses this to trigger a full replay from the cloud first.
   */
  isBare(): boolean {
    const PROTECTED = new Set([
      ROOT_UUID,
      BOOKMARKS_BAR_UUID,
      OTHER_BOOKMARKS_UUID,
      MOBILE_UUID,
    ]);
    return this.getVisibleTree().every((e) => PROTECTED.has(e.child));
  }

  // ── GC snapshot (Phase 4) ────────────────────────────────────────────────

  /**
   * Snapshot of the current tree, for op-log GC. `nodes` is the full
   * childId -> { parent, meta } projection (fixed roots included);
   * `w` is the largest Lamport timestamp folded into the snapshot (may be
   * null for an empty replica). Consumers encrypt this whole object
   * (operation-level E2EE) before storing it server-side.
   */
  exportSnapshot(): SnapshotData {
    const nodes: Record<string, { parent: string; meta: Metadata }> = {};
    for (const [child, { parent, meta }] of this.state.tree) {
      nodes[child] = { parent, meta };
    }
    let w: Timestamp | null = null;
    for (const lm of this.state.log) {
      if (!w || cmpTimestamp(lm.t, w) > 0) w = lm.t;
    }
    return { w, nodes };
  }

  /**
   * Rebuild the replica from a snapshot projection (after op-log GC).
   * Replaces the tree wholesale and clears the local op log; the gcWatermark
   * is set so any op with t <= watermark received later is skipped (its
   * effect is already folded into the snapshot). Local counter is kept above
   * the watermark so future local ops stay strictly newer.
   */
  applySnapshot(snap: SnapshotData): void {
    const tree = new Map<string, { parent: string; meta: Metadata }>();
    for (const [child, v] of Object.entries(snap?.nodes ?? {})) {
      tree.set(child, { parent: v.parent, meta: v.meta ?? {} });
    }
    this.state = { log: [], tree };
    this.gcWatermark = snap?.w ?? null;
    this.counter = Math.max(this.counter, (snap?.w?.counter ?? 0) + 1);
    this.bumpVersion();
  }
}

/** Snapshot payload (see Replica.exportSnapshot / applySnapshot). */
export interface SnapshotData {
  w: Timestamp | null;
  nodes: Record<string, { parent: string; meta: Metadata }>;
}

export { ROOT_NODE_ID, TRASH_NODE_ID };
