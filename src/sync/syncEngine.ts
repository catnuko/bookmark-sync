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
} from '../crdt/index.js';
import { encryptMoveOp, decryptMoveOp } from './opCrypto.js';
import type { OpLogTransport, PushOp, OpRow } from './oplogClient.js';

export interface SyncCoordinatorOptions {
  spaceId: string;
  /** UUID used both as bsync device_id and CRDT replicaId. */
  deviceId: string;
  transport: OpLogTransport;
  /** AES-256-GCM key for operation-level E2EE. */
  key: CryptoKey;
  /** starting pull cursor (global op_log id already applied locally). */
  afterId?: number;
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
    const sent = this.pendingPush.length;
    this.pendingPush = [];
    await this.transport.push(this.spaceId, this.deviceId, batch);
    return sent;
  }

  // ── Pull ────────────────────────────────────────────────────────────────

  /**
   * Pull new rows since `afterId`, decrypt, and apply via receiveOp.
   * Pages through has_more until the server says we're caught up.
   */
  async pull(): Promise<PullOutcome> {
    let applied = 0;
    let skipped = 0;
    for (;;) {
      const page = await this.transport.pull(this.spaceId, this.afterId, 1000);
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
      if (page.rows.length) this.afterId = page.last_id;
      if (!page.has_more) break;
    }
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
}
