/**
 * Operation-log transport layer (v2 contract, Phase C-2).
 *
 * Aligned to docs/migrations/20260914_v2_move_crdt.sql:
 *
 *   bsync_op_push(p_space UUID, p_device UUID, p_ops JSONB) -> {inserted INT}
 *     p_ops = array of { seq, op, cid }
 *       - seq  : per-device monotonic (we use the CRDT Lamport counter)
 *       - op   : EncryptedOpEnvelope JSONB (operation-level E2EE)
 *       - cid  : optional tamper-evidence digest (nullable)
 *     ON CONFLICT(space_id, device_id, seq) DO NOTHING  -> idempotent.
 *
 *   bsync_op_pull(p_space UUID, p_after_id BIGINT, p_limit INT)
 *     -> { rows: [{id, device_id, seq, op, cid, created_at}], last_id, has_more }
 *     The global bigserial `id` is the incremental cursor (NOT the per-device seq).
 *
 * device_id is a UUID generated once per device and reused as the CRDT
 * replicaId, so one id plays both roles.
 */

import type { MoveOp } from '../crdt/index.js';
import type { EncryptedOpEnvelope } from './opCrypto.js';

/** One op the client wants to push (mirrors an element of p_ops). */
export interface PushOp {
  /** per-device monotonic = CRDT Lamport counter. */
  seq: number;
  /** encrypted whole-MoveOp envelope (JSONB). */
  op: EncryptedOpEnvelope;
  /** optional tamper-evidence digest; nullable. */
  cid?: string | null;
}

/** One row returned by bsync_op_pull. */
export interface OpRow {
  /** global bigserial cursor. */
  id: number;
  device_id: string;
  seq: number;
  op: EncryptedOpEnvelope;
  cid: string | null;
  created_at: string;
}

export interface PullResult {
  rows: OpRow[];
  /** largest row id in this space (use as next afterId). */
  last_id: number;
  has_more: boolean;
}

export interface PushResult {
  inserted: number;
}

/** One snapshot row (bsync_snapshots). data is an encrypted envelope. */
export interface SnapshotRow {
  id: number;
  after_op_id: number | null;
  data: EncryptedOpEnvelope | null;
  created_at: string;
}

/** Result of a maybe-GC attempt. */
export interface GcResult {
  /** true when the op log crossed the threshold and was truncated. */
  gced: boolean;
  /** number of op_log rows deleted (0 when not gced). */
  deleted: number;
  snapshot_id: number | null;
}

/**
 * Transport abstraction. Implementations must:
 *  - push: batch-insert; ON CONFLICT(space_id, device_id, seq) DO NOTHING.
 *  - pull: rows with global id > afterId, ordered by id ASC, paginated.
 *  - snapshotPull: latest snapshot of the space (null when none).
 *  - maybeGc: if row count > threshold, store a snapshot (encrypted client
 *    projection) at the current max id and delete op_log rows <= that id
 *    (keeping at most the latest snapshot). This is the op-log GC entry point.
 */
export interface OpLogTransport {
  push(spaceId: string, deviceId: string, ops: PushOp[]): Promise<PushResult>;
  pull(spaceId: string, afterId: number, limit?: number): Promise<PullResult>;
  snapshotPull(spaceId: string): Promise<SnapshotRow | null>;
  maybeGc(spaceId: string, threshold: number, projection: EncryptedOpEnvelope): Promise<GcResult>;
}

/** Build the seq (per-device monotonic) from a MoveOp's Lamport counter. */
export function seqOf(op: MoveOp): number {
  return op.t.counter;
}

/**
 * In-memory OpLogTransport for tests (mock Supabase).
 *
 * Emulates the SQL: a global bigserial `id` counter, and
 * ON CONFLICT(space_id, device_id, seq) DO NOTHING semantics.
 */
export class MemoryOpLogTransport implements OpLogTransport {
  private rows: OpRow[] = [];
  private snapshots: Array<{
    id: number;
    space_id: string;
    after_op_id: number | null;
    data: EncryptedOpEnvelope | null;
    created_at: string;
  }> = [];
  private nextId = 1;
  private snapId = 1;

  async push(
    spaceId: string,
    deviceId: string,
    ops: PushOp[],
  ): Promise<PushResult> {
    let inserted = 0;
    for (const o of ops) {
      const dup = this.rows.some(
        (r) => r.space_id === spaceId && r.device_id === deviceId && r.seq === o.seq,
      );
      if (dup) continue;
      this.rows.push({
        id: this.nextId++,
        space_id: spaceId,
        device_id: deviceId,
        seq: o.seq,
        op: o.op,
        cid: o.cid ?? null,
        created_at: new Date().toISOString(),
      });
      inserted++;
    }
    return { inserted };
  }

  async pull(
    spaceId: string,
    afterId: number,
    limit = 1000,
  ): Promise<PullResult> {
    const all = this.rows
      .filter((r) => r.space_id === spaceId && r.id > afterId)
      .sort((a, b) => a.id - b.id);
    const page = all.slice(0, limit);
    const lastId = page.length ? page[page.length - 1].id : afterId;
    return { rows: page, last_id: lastId, has_more: all.length > page.length };
  }

  async snapshotPull(spaceId: string): Promise<SnapshotRow | null> {
    const snaps = this.snapshots
      .filter((s) => s.space_id === spaceId)
      .sort((a, b) => a.id - b.id);
    const last = snaps[snaps.length - 1];
    if (!last) return null;
    return {
      id: last.id,
      after_op_id: last.after_op_id,
      data: last.data,
      created_at: last.created_at,
    };
  }

  async maybeGc(
    spaceId: string,
    threshold: number,
    projection: EncryptedOpEnvelope,
  ): Promise<GcResult> {
    const count = this.rows.filter((r) => r.space_id === spaceId).length;
    if (count <= threshold) return { gced: false, deleted: 0, snapshot_id: null };
    const maxId = Math.max(
      ...this.rows.filter((r) => r.space_id === spaceId).map((r) => r.id),
      0,
    );
    this.snapshots = this.snapshots.filter((s) => s.space_id !== spaceId);
    this.snapshots.push({
      id: this.snapId++,
      space_id: spaceId,
      after_op_id: maxId,
      data: projection,
      created_at: new Date().toISOString(),
    });
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.space_id !== spaceId || r.id > maxId);
    return {
      gced: true,
      deleted: before - this.rows.length,
      snapshot_id: this.snapshots[this.snapshots.length - 1].id,
    };
  }

  /** Test helper: total row count across spaces. */
  get size(): number {
    return this.rows.length;
  }
}

/** Minimal shape of the Supabase client (injected to keep this testable). */
export interface SupabaseRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

/**
 * Supabase-backed transport. Thin wrapper over bsync_op_push / bsync_op_pull.
 */
export class SupabaseOpLogTransport implements OpLogTransport {
  constructor(private readonly client: SupabaseRpcClient) {}

  async push(
    spaceId: string,
    deviceId: string,
    ops: PushOp[],
  ): Promise<PushResult> {
    if (ops.length === 0) return { inserted: 0 };
    const { data, error } = await this.client.rpc('bsync_op_push', {
      p_space: spaceId,
      p_device: deviceId,
      p_ops: ops.map((o) => ({ seq: o.seq, op: o.op, cid: o.cid ?? null })),
    });
    if (error) throw error instanceof Error ? error : new Error(String(error));
    const r = data as { inserted?: number };
    return { inserted: r.inserted ?? 0 };
  }

  async pull(
    spaceId: string,
    afterId: number,
    limit = 1000,
  ): Promise<PullResult> {
    const { data, error } = await this.client.rpc('bsync_op_pull', {
      p_space: spaceId,
      p_after_id: afterId,
      p_limit: limit,
    });
    if (error) throw error instanceof Error ? error : new Error(String(error));
    const r = data as {
      rows?: Array<{
        id: number;
        device_id: string;
        seq: number;
        op: EncryptedOpEnvelope;
        cid: string | null;
        created_at: string;
      }>;
      last_id?: number;
      has_more?: boolean;
    };
    return {
      rows: (r.rows ?? []).map((x) => ({
        id: Number(x.id),
        device_id: x.device_id,
        seq: Number(x.seq),
        op: x.op,
        cid: x.cid ?? null,
        created_at: x.created_at,
      })),
      last_id: Number(r.last_id ?? afterId),
      has_more: r.has_more ?? false,
    };
  }

  async snapshotPull(spaceId: string): Promise<SnapshotRow | null> {
    const { data, error } = await this.client.rpc('bsync_snapshot_pull', {
      p_space: spaceId,
    });
    if (error) throw error instanceof Error ? error : new Error(String(error));
    if (!data) return null;
    const r = data as {
      id?: number;
      after_op_id?: number | null;
      data?: EncryptedOpEnvelope | null;
      created_at?: string;
    };
    return {
      id: Number(r.id),
      after_op_id: r.after_op_id != null ? Number(r.after_op_id) : null,
      data: r.data ?? null,
      created_at: r.created_at ?? '',
    };
  }

  async maybeGc(
    spaceId: string,
    threshold: number,
    projection: EncryptedOpEnvelope,
  ): Promise<GcResult> {
    const { data, error } = await this.client.rpc('bsync_op_maybe_gc', {
      p_space: spaceId,
      p_threshold: threshold,
      p_projection: projection,
    });
    if (error) throw error instanceof Error ? error : new Error(String(error));
    const r = (data ?? {}) as {
      gced?: boolean;
      deleted?: number;
      snapshot_id?: number | null;
    };
    return {
      gced: r.gced ?? false,
      deleted: r.deleted ?? 0,
      snapshot_id: r.snapshot_id != null ? Number(r.snapshot_id) : null,
    };
  }
}
