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
import { describeError } from '../lib/errors.js';
import type { EncryptedOpEnvelope } from './opCrypto.js';

/**
 * 把 supabase RPC 返回的 `error` 变成**不丢信息**的 Error。
 *
 * 它不保证是 Error 实例（实测见过普通对象），而 `new Error(String(error))` 会把
 * 这种对象压成 `Error("[object Object]")` —— **message 与 stack 双废**，上层
 * `src/sync.js` 的语义码映射（`msg.includes('quota_exceeded')` / `rate_limited` /
 * `device_limit_reached`）也永远命中不了，用户看到的是通用报错而非升级引导。
 * 2026-09-22 排查 E2E two-device-sync「删除后 A 拉取失败」就是被它挡住：
 * `lastSyncError` 只剩 `[object Object] | Error: [object Object]`，连是哪个 RPC
 * 失败都看不出。
 */
function rpcError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(describeError(error));
}

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
  /** owning space (bsync_op_pull 返回的行含该列；内存实现亦按此过滤). */
  space_id: string;
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
  /** 服务端判定：op_log 超过用户动态阈值或后台请求 GC（客户端据此自动配合）。 */
  gc_needed: boolean;
}

export interface PushResult {
  inserted: number;
  /** 服务端判定：op_log 超过用户动态阈值或后台请求 GC。 */
  gc_needed: boolean;
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
  /**
   * 客户端侧拒绝执行的附加原因（服务端拒绝时不返回）：
   * 'replica_incomplete' = 本地 replica 有解密失败缺行，快照会丢数据，拒绝生成投影。
   */
  reason?: 'replica_incomplete';
}

/**
 * Transport abstraction. Implementations must:
 *  - push: batch-insert; ON CONFLICT(space_id, device_id, seq) DO NOTHING.
 *  - pull: rows with global id > afterId, ordered by id ASC, paginated.
 *  - snapshotPull: latest snapshot of the space (null when none).
 *  - maybeGc: store a snapshot (encrypted client projection) at the current
 *    max id and delete op_log rows <= that id (keeping at most the latest
 *    snapshot). Whether GC actually runs is decided by the SERVER (user
 *    dynamic threshold or admin request) — the client only supplies the
 *    encrypted projection.
 */
export interface OpLogTransport {
  push(spaceId: string, deviceId: string, ops: PushOp[]): Promise<PushResult>;
  pull(spaceId: string, afterId: number, limit?: number): Promise<PullResult>;
  snapshotPull(spaceId: string): Promise<SnapshotRow | null>;
  maybeGc(spaceId: string, projection: EncryptedOpEnvelope): Promise<GcResult>;
}

/** 内存实现的内部 GC 判定阈值（与服务端 free 默认一致；服务端以实际阈值为准）。 */
const MEMORY_GC_THRESHOLD = 2000;

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

  /**
   * 内存实现的可配置 GC 阈值（默认与服务端 free 一致 2000）。
   * 服务端托管后阈值由服务端决定；这里仅模拟「行数超过阈值即允许 GC」的判定，
   * 测试可传小阈值触发截断。
   */
  constructor(private readonly gcThreshold: number = MEMORY_GC_THRESHOLD) {}

  async push(spaceId: string, deviceId: string, ops: PushOp[]): Promise<PushResult> {
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
    return { inserted, gc_needed: this.gcNeededFor(spaceId) };
  }

  async pull(spaceId: string, afterId: number, limit = 1000): Promise<PullResult> {
    const all = this.rows
      .filter((r) => r.space_id === spaceId && r.id > afterId)
      .sort((a, b) => a.id - b.id);
    const page = all.slice(0, limit);
    const lastId = page.length ? page[page.length - 1].id : afterId;
    return {
      rows: page,
      last_id: lastId,
      has_more: all.length > page.length,
      gc_needed: this.gcNeededFor(spaceId),
    };
  }

  /** 内存实现的判定：行数超过内部阈值即标记（服务端以用户动态阈值为准）。 */
  private gcNeededFor(spaceId: string): boolean {
    return this.rows.filter((r) => r.space_id === spaceId).length > this.gcThreshold;
  }

  async snapshotPull(spaceId: string): Promise<SnapshotRow | null> {
    const snaps = this.snapshots.filter((s) => s.space_id === spaceId).sort((a, b) => a.id - b.id);
    const last = snaps[snaps.length - 1];
    if (!last) return null;
    return {
      id: last.id,
      after_op_id: last.after_op_id,
      data: last.data,
      created_at: last.created_at,
    };
  }

  async maybeGc(spaceId: string, projection: EncryptedOpEnvelope): Promise<GcResult> {
    const count = this.rows.filter((r) => r.space_id === spaceId).length;
    if (count <= this.gcThreshold) return { gced: false, deleted: 0, snapshot_id: null };
    const maxId = Math.max(...this.rows.filter((r) => r.space_id === spaceId).map((r) => r.id), 0);
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
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}

/**
 * Supabase-backed transport. Thin wrapper over bsync_op_push / bsync_op_pull.
 */
export class SupabaseOpLogTransport implements OpLogTransport {
  constructor(private readonly client: SupabaseRpcClient) {}

  async push(spaceId: string, deviceId: string, ops: PushOp[]): Promise<PushResult> {
    if (ops.length === 0) return { inserted: 0, gc_needed: false };
    const { data, error } = await this.client.rpc('bsync_op_push', {
      p_space: spaceId,
      p_device: deviceId,
      p_ops: ops.map((o) => ({ seq: o.seq, op: o.op, cid: o.cid ?? null })),
    });
    if (error) throw rpcError(error);
    const r = data as { inserted?: number; gc_needed?: boolean };
    return { inserted: r.inserted ?? 0, gc_needed: r.gc_needed ?? false };
  }

  async pull(spaceId: string, afterId: number, limit = 1000): Promise<PullResult> {
    const { data, error } = await this.client.rpc('bsync_op_pull', {
      p_space: spaceId,
      p_after_id: afterId,
      p_limit: limit,
    });
    if (error) throw rpcError(error);
    const r = data as {
      rows?: Array<{
        id: number;
        space_id: string;
        device_id: string;
        seq: number;
        op: EncryptedOpEnvelope;
        cid: string | null;
        created_at: string;
      }>;
      last_id?: number;
      has_more?: boolean;
      gc_needed?: boolean;
    };
    return {
      rows: (r.rows ?? []).map((x) => ({
        id: Number(x.id),
        space_id: x.space_id,
        device_id: x.device_id,
        seq: Number(x.seq),
        op: x.op,
        cid: x.cid ?? null,
        created_at: x.created_at,
      })),
      last_id: Number(r.last_id ?? afterId),
      has_more: r.has_more ?? false,
      gc_needed: r.gc_needed ?? false,
    };
  }

  async snapshotPull(spaceId: string): Promise<SnapshotRow | null> {
    const { data, error } = await this.client.rpc('bsync_snapshot_pull', {
      p_space: spaceId,
    });
    if (error) throw rpcError(error);
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

  async maybeGc(spaceId: string, projection: EncryptedOpEnvelope): Promise<GcResult> {
    // 是否执行 GC 由服务端判定（用户动态阈值或后台请求），客户端只提供加密投影
    const { data, error } = await this.client.rpc('bsync_op_maybe_gc', {
      p_space: spaceId,
      p_projection: projection,
    });
    if (error) throw rpcError(error);
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
