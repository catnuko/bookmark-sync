/**
 * SyncCoordinator — wires the Move-CRDT Replica, the encrypted op-log
 * transport, and operation-level E2EE together (Phase C-2).
 *
 *   local mutation  -> Replica (apply_op) -> queue -> encrypt whole op
 *                   -> bsync_op_push (batch, idempotent on seq)
 *   pull            -> bsync_op_pull(spaceId, afterId) -> decrypt envelope
 *                   -> Replica.receiveOp (Lamport order-agnostic)
 *
 * The coordinator does NOT know about chrome.bookmarks. It speaks in CRDT
 * ids and MoveOps. The chrome bridge (chromeBridge.ts) adapts the browser's
 * bookmark tree to this coordinator.
 */

import {
  Replica,
  logMoveToOp,
  type MoveOp,
  type Metadata,
  type SnapshotData,
} from '../crdt/index.js';
import { encryptMoveOp, decryptMoveOp, encryptJson, decryptJson } from './opCrypto.js';
import type { OpLogTransport, PushOp, OpRow, GcResult } from './oplogClient.js';

export interface SyncCoordinatorOptions {
  spaceId: string;
  /** UUID used both as bsync device_id and CRDT replicaId. */
  deviceId: string;
  transport: OpLogTransport;
  /** AES-256-GCM key for operation-level E2EE. */
  key: CryptoKey;
  /** starting pull cursor (global op_log id already applied locally). */
  afterId?: number;
  /**
   * Restored per-device Lamport counter (persisted alongside afterId).
   *
   * MV3 service workers are terminated on idle; a fresh in-memory replica
   * starts its counter at the fixed-root value (5). Without restoring the
   * counter, the first local op after a cold start reuses a seq that the
   * PREVIOUS SW instance already pushed for this device, and the server's
   * ON CONFLICT (space_id, device_id, seq) DO NOTHING silently drops it —
   * a deletion tombstone never reaches the server and the deleted node is
   * resurrected by the next full replay.
   */
  initialCounter?: number;
}

export interface PullOutcome {
  applied: number;
  skipped: number;
  afterId: number;
}

export class SyncCoordinator {
  readonly replica: Replica;
  readonly spaceId: string;
  readonly deviceId: string;
  private readonly transport: OpLogTransport;
  private readonly key: CryptoKey;

  /** rows pulled from the server but not yet applied (order-agnostic anyway). */
  private pendingPush: MoveOp[] = [];
  /** global op_log id of the last row pulled + applied. */
  afterId: number;

  constructor(opts: SyncCoordinatorOptions) {
    this.spaceId = opts.spaceId;
    this.deviceId = opts.deviceId;
    this.transport = opts.transport;
    this.key = opts.key;
    this.afterId = opts.afterId ?? 0;
    // deviceId doubles as the CRDT replicaId.
    this.replica = new Replica(opts.deviceId);
    // Fixed root structure must exist before any user node is attached
    // (getVisibleTree / reverseApply depend on it).
    this.replica.ensureRoots();
    // Cold-start guard: never let a fresh replica reuse seqs this device
    // already pushed (ON CONFLICT DO NOTHING would silently drop the op).
    // This is deliberately applied AFTER ensureRoots() so the roots' fixed
    // timestamps (1..5) stay untouched.
    if (opts.initialCounter != null && opts.initialCounter > 0) {
      this.replica.counter = Math.max(this.replica.counter, opts.initialCounter);
    }
  }

  // ── Local mutations: apply to CRDT, enqueue for push ──────────────────────

  private enqueueLastOp(): void {
    const lm = this.replica.state.log[0];
    if (!lm) return;
    this.pendingPush.push(logMoveToOp(lm));
  }

  createNode(parentId: string, meta: Metadata): string {
    const id = this.replica.createNode(parentId, meta);
    this.enqueueLastOp();
    return id;
  }

  /** Create with an explicit node id (used by the chrome bridge so that the
   *  chromeId->uuid mapping matches the CRDT node id). */
  createNodeWithId(nodeId: string, parentId: string, meta: Metadata): string {
    this.replica.createNodeWithId(nodeId, parentId, meta);
    this.enqueueLastOp();
    return nodeId;
  }

  moveNode(nodeId: string, newParentId: string, meta?: Metadata): void {
    this.replica.moveNode(nodeId, newParentId, meta);
    this.enqueueLastOp();
  }

  deleteNode(nodeId: string): void {
    this.replica.deleteNode(nodeId);
    this.enqueueLastOp();
  }

  // ── Push ────────────────────────────────────────────────────────────────

  /** Encrypt queued ops and batch-push. Returns how many rows were sent. */
  async flushPush(): Promise<number> {
    if (this.pendingPush.length === 0) return 0;
    const batch: PushOp[] = [];
    for (const op of this.pendingPush) {
      const envelope = await encryptMoveOp(op, this.key, this.spaceId);
      batch.push({ seq: op.t.counter, op: envelope, cid: null });
    }
    // Only drop the queue AFTER a successful push. Clearing it first meant a
    // transient transport failure (network blip, RLS hiccup) permanently lost
    // the ops — including deletion tombstones — with no way to retry, and the
    // next full replay would resurrect the "deleted" nodes.
    await this.transport.push(this.spaceId, this.deviceId, batch);
    this.pendingPush = [];
    return batch.length;
  }

  // ── Pull ────────────────────────────────────────────────────────────────

  /**
   * Pull new rows since `afterId`, decrypt, and apply via receiveOp.
   * Pages through has_more until the server says we're caught up.
   */
  async pull(): Promise<PullOutcome> {
    return this.pullFrom(this.afterId);
  }

  /**
   * Pull rows since `afterId` (inclusive-exclusive), decrypt, apply, and page
   * until caught up. Used for incremental pulls AND for cold-start full replay
   * (pass 0 when the replica was rebuilt in memory after an SW restart).
   */
  async pullFrom(startAfterId: number): Promise<PullOutcome> {
    let applied = 0;
    let skipped = 0;
    let afterId = startAfterId;
    for (;;) {
      const page = await this.transport.pull(this.spaceId, afterId, 1000);
      for (const row of page.rows) {
        try {
          const op = await decryptMoveOp(row.op, this.key, this.spaceId);
          this.replica.receiveOp(op);
          applied++;
        } catch {
          // Wrong key / tamper: skip the row, never stall the pipeline.
          skipped++;
        }
      }
      if (page.rows.length) afterId = page.last_id;
      if (!page.has_more) break;
    }
    if (afterId > this.afterId) this.afterId = afterId;
    return { applied, skipped, afterId: this.afterId };
  }

  /** Apply a single already-decrypted op (used by bridge/tests). */
  receiveOp(op: MoveOp): void {
    this.replica.receiveOp(op);
  }

  /** Decrypt a raw pull row (exposed for tests). */
  async decryptRow(row: OpRow): Promise<MoveOp> {
    return decryptMoveOp(row.op, this.key, this.spaceId);
  }

  // ── GC snapshots (Phase 4) ───────────────────────────────────────────────

  /**
   * Pull with snapshot-first semantics:
   *  - if a usable snapshot exists and it is newer than the local cursor
   *    (or the local replica is cold/bare — `force`), rebuild from the
   *    snapshot, then incrementally pull ops after the snapshot watermark;
   *  - otherwise fall back to plain incremental pull (`force` falls back to
   *    a full replay from 0 when no snapshot exists — GC-safe only if the
   *    log was never truncated).
   *
   * `force` is used on cold start (bare in-memory replica): a snapshot is the
   * only reliable baseline after the op log was GC-truncated (pullFrom(0)
   * would silently miss rows that were already deleted).
   */
  async pullWithSnapshot(force = false): Promise<PullOutcome> {
    const snap = await this.transport.snapshotPull(this.spaceId);
    const usable =
      snap?.data != null &&
      snap.after_op_id != null &&
      snap.after_op_id > 0;
    if (usable && (force || snap.after_op_id! > this.afterId || this.afterId === 0)) {
      try {
        const data = await decryptJson<SnapshotData>(snap.data!, this.key, this.spaceId);
        this.replica.applySnapshot(data);
        this.afterId = snap.after_op_id!;
        return this.pullFrom(this.afterId);
      } catch {
        // Snapshot undecryptable (wrong key / tamper): fall back below.
      }
    }
    return force ? this.pullFrom(0) : this.pull();
  }

  /**
   * Snapshot the current replica and ask the server to truncate the op log
   * if it has grown past `threshold`. The projection is encrypted before it
   * leaves the device (operation-level E2EE). Safe to call after a complete
   * pull: the local replica then holds the full tree.
   */
  async maybeGc(threshold: number): Promise<GcResult> {
    const projection = this.replica.exportSnapshot();
    const envelope = await encryptJson(projection, this.key, this.spaceId);
    return this.transport.maybeGc(this.spaceId, threshold, envelope);
  }
}
