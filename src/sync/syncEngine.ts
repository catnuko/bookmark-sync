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
  /**
   * 单块推送的 op 数上限（默认 500）。数千条批量导入不再塞进单个巨型
   * POST——网关 413/超时/整批配额拒绝会把「全部或没有」变成确定性失败，
   * 分块后失败重试范围只剩未确认的块。
   */
  pushChunkSize?: number;
  /** 本地 op 入队后回调（sync.js 用它调度 outbox 落盘 tick）。 */
  onOpEnqueued?: () => void;
  /** 每块推送确认后回调（sync.js 删除对应 outbox 行；漏删由服务端幂等去重兜底）。 */
  onChunkPushed?: (spaceId: string, seqs: number[]) => Promise<void> | void;
}

export interface PullOutcome {
  applied: number;
  skipped: number;
  afterId: number;
  /** 解密失败的行详情（最多记录前 5 条，便于诊断密钥不匹配）。 */
  decryptErrors: Array<{ id: number; seq: number; device_id: string }>;
}

export class SyncCoordinator {
  readonly replica: Replica;
  readonly spaceId: string;
  readonly deviceId: string;
  private readonly transport: OpLogTransport;
  private readonly key: CryptoKey;
  private readonly pushChunkSize: number;
  private readonly onOpEnqueued?: () => void;
  private readonly onChunkPushed?: (spaceId: string, seqs: number[]) => Promise<void> | void;

  /** rows pulled from the server but not yet applied (order-agnostic anyway). */
  private pendingPush: MoveOp[] = [];
  /**
   * 尚未写入 outbox 的本地 op（sync.js 持久化 tick 消费）。
   * outbox 行 = pendingPush 的持久镜像；见 storage/outbox.ts 的不变式。
   */
  private pendingJournal: MoveOp[] = [];
  /** flushPush 防重入：flushSoon 与 runSync 并发触发时只跑一份分块循环。 */
  private pushing = false;
  /**
   * restoreOutbox 恢复的本地 op（未确认推送成功）。applySnapshot 会整体替换
   * replica 状态，快照重建后必须重放这些 op（经 receiveLocalOp 豁免水位守卫
   * ——它们不可能存在于任何服务端快照中）。
   */
  private restoredOps: MoveOp[] = [];
  /** global op_log id of the last row pulled + applied. */
  afterId: number;
  /** 服务端标记：op_log 超过用户动态阈值或后台请求 GC，本机应配合压缩。 */
  private gcNeededFlag = false;

  /**
   * 冷启动重放判定：replica 是新建的空壳（只有固定根），或持有 outbox 恢复
   * 的 op（同样只有部分状态）。两者都必须先从服务端基线（快照/全量重放）
   * 重建完整历史，再做 reverseApply——否则缺历史会被当成「远端已删除」，
   * mapped-but-unreachable 的本地书签会被误删。
   */
  get needsColdReplay(): boolean {
    return this.restoredOps.length > 0 || this.replica.isBare();
  }

  /**
   * replica 完整性标志：本次实例是否跳过过解不开的 op 行。
   *
   * 数据安全守卫：GC 会把 ≤ 水位的历史 op 行截断为一份快照（快照由本机
   * 加密投影生成）。若 replica 因解密失败缺行（密钥不匹配 / 改密钥迁移场景），
   * 生成的快照会缺这些 op 的内容，截断后即永久丢失。因此任何跳过都置位；
   * 只有「快照重建」或「从 0 全量重放且零跳过」才视为补齐并复位。
   * 注意：增量拉取零跳过不会复位——被跳过的行在水位之下，永远不会重拉。
   * 实例随 resetCoordinator 重建（换密钥），新实例从 false 开始。
   */
  private replicaIncomplete = false;

  /** 服务端要求配合 GC 的标志（本次同步中 push/pull 任一返回 true 即成立）。 */
  get gcNeeded(): boolean {
    return this.gcNeededFlag;
  }

  /**
   * 当前待推送 op 数（sync.js 换绑前 drainPush 轮询用）。
   * pendingPush 为私有字段；原 JS 版直接访问私有成员，迁 TS 后走公开 getter。
   */
  get pendingPushCount(): number {
    return this.pendingPush.length;
  }

  constructor(opts: SyncCoordinatorOptions) {
    this.spaceId = opts.spaceId;
    this.deviceId = opts.deviceId;
    this.transport = opts.transport;
    this.key = opts.key;
    this.pushChunkSize = Math.max(1, opts.pushChunkSize ?? 500);
    this.onOpEnqueued = opts.onOpEnqueued;
    this.onChunkPushed = opts.onChunkPushed;
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
    this.pendingJournal.push(logMoveToOp(lm));
    this.onOpEnqueued?.();
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

  /**
   * 取出尚未写入 outbox 的本地 op（由 sync.js 持久化 tick 消费）。
   * 调用方须在成功落盘后调 clearPendingJournal，失败时保留重试。
   */
  peekPendingJournal(): MoveOp[] {
    return this.pendingJournal;
  }

  clearPendingJournal(ops: MoveOp[]): void {
    const seqs = new Set(ops.map((o) => o.t.counter));
    this.pendingJournal = this.pendingJournal.filter((o) => !seqs.has(o.t.counter));
  }

  /**
   * SW 冷启动恢复：outbox 中未确认推送的本地 op 重放进 replica 并重回
   * 推送队列。receiveOp 幂等（后续服务端重放同 op 无副作用），counter
   * 由 receiveOp 抬升到 max(counter, seq)，保证后续新 op 不复用 seq
   * （否则 ON CONFLICT DO NOTHING 会静默丢弃新 op）。
   */
  restoreOutbox(rows: Array<{ seq: number; op: MoveOp }>): void {
    const sorted = [...rows].sort((a, b) => a.seq - b.seq);
    for (const row of sorted) {
      if (this.pendingPush.some((o) => o.t.counter === row.seq)) continue;
      this.replica.receiveLocalOp(row.op);
      this.pendingPush.push(row.op);
      this.restoredOps.push(row.op);
    }
  }

  /**
   * Encrypt queued ops and batch-push. Returns how many rows were sent.
   *
   * 分块推送：pendingPush 按上限切片顺序推，每块确认后即移出队列并回调
   * onChunkPushed（删除对应 outbox 行）。中途失败时已确认块不重传、剩余块
   * 留在队列（outbox 已落盘）跨 SW 生命周期重试——「推送失败 + SW 回收导致
   * 整批丢失」的数据丢失窗口就此关闭。重复推送由服务端
   * (space_id, device_id, seq) 幂等去重兜底。
   */
  async flushPush(): Promise<number> {
    if (this.pushing) return 0; // flushSoon 与 runSync 并发触发时只跑一份
    if (this.pendingPush.length === 0) return 0;
    this.pushing = true;
    try {
      let totalInserted = 0;
      while (this.pendingPush.length > 0) {
        const chunk = this.pendingPush.slice(0, this.pushChunkSize);
        const batch: PushOp[] = [];
        for (const op of chunk) {
          const envelope = await encryptMoveOp(op, this.key, this.spaceId);
          batch.push({ seq: op.t.counter, op: envelope, cid: null });
        }
        // Only drop the chunk AFTER a successful push. Clearing it first
        // meant a transient transport failure (network blip, RLS hiccup)
        // permanently lost the ops — including deletion tombstones — with
        // no way to retry, and the next full replay would resurrect the
        // "deleted" nodes.
        const result = await this.transport.push(this.spaceId, this.deviceId, batch);
        if (result.gc_needed) this.gcNeededFlag = true;
        totalInserted += result.inserted;
        this.pendingPush.splice(0, chunk.length);
        const seqs = chunk.map((op) => op.t.counter);
        this.clearPendingJournal(chunk);
        await this.onChunkPushed?.(this.spaceId, seqs);
      }
      // 返回实际插入数（ON CONFLICT DO NOTHING 可能跳过重复 seq），
      // 而非 batch.length——否则前端会误报「推送 N 条」但实际未落库。
      return totalInserted;
    } finally {
      this.pushing = false;
    }
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
    const decryptErrors: PullOutcome['decryptErrors'] = [];
    let afterId = startAfterId;
    for (;;) {
      const page = await this.transport.pull(this.spaceId, afterId, 1000);
      if (page.gc_needed) this.gcNeededFlag = true;
      for (const row of page.rows) {
        try {
          const op = await decryptMoveOp(row.op, this.key, this.spaceId);
          this.replica.receiveOp(op);
          applied++;
        } catch (e) {
          // Wrong key / tamper: skip the row, never stall the pipeline.
          console.log(
            `[bsync]   拉取行 #${row.id} 解密失败: seq=${row.seq} device=${row.device_id} err=${(e as Error)?.message ?? e}`,
          );
          skipped++;
          if (decryptErrors.length < 5) {
            decryptErrors.push({
              id: row.id,
              seq: row.seq,
              device_id: row.device_id,
            });
          }
        }
      }
      if (page.rows.length) afterId = page.last_id;
      if (!page.has_more) break;
    }
    if (afterId > this.afterId) this.afterId = afterId;
    // 完整性守卫：任何跳过都意味着 replica 缺行（水位已越过它们，不会重拉）；
    // 仅当「从 0 全量重放且零跳过」时才视为补齐复位（增量拉取零跳过不证明完整）。
    if (skipped > 0) this.replicaIncomplete = true;
    else if (startAfterId === 0) this.replicaIncomplete = false;
    return { applied, skipped, afterId: this.afterId, decryptErrors };
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
    const usable = snap?.data != null && snap.after_op_id != null && snap.after_op_id > 0;
    if (usable && (force || snap.after_op_id! > this.afterId || this.afterId === 0)) {
      try {
        const data = await decryptJson<SnapshotData>(snap.data!, this.key, this.spaceId);
        this.replica.applySnapshot(data);
        this.afterId = snap.after_op_id!;
        // 快照重建整体替换了状态：outbox 恢复的本地 op 不在任何服务端快照里
        // （从未推送成功），必须经 receiveLocalOp（豁免水位守卫）重放回来，
        // 否则节点从 replica 消失 → mapped-but-unreachable → 本地误删。
        for (const op of this.restoredOps) this.replica.receiveLocalOp(op);
        // 快照重建成功 → ≤ 水位基线段完整（尾段由 pullFrom 续判）
        this.replicaIncomplete = false;
        return this.pullFrom(this.afterId);
      } catch (e) {
        // Snapshot undecryptable (wrong key / tamper): fall back below,
        // but record the failure so the caller can surface it to the user.
        const fallback = await (force ? this.pullFrom(0) : this.pull());
        fallback.decryptErrors.unshift({
          id: -1,
          seq: -1,
          device_id: 'snapshot',
        });
        // 快照解不开 = 基线未知（op 可能已被 GC 截断，全量重放也补不回）→
        // 视作不完整，禁止本实例后续 GC，防止用残缺投影覆盖并截断历史。
        this.replicaIncomplete = true;
        return fallback;
      }
    }
    return force ? this.pullFrom(0) : this.pull();
  }

  /**
   * Snapshot the current replica and ask the server to truncate the op log.
   * 是否执行由服务端判定（用户动态阈值或后台请求，见 bsync_op_maybe_gc），
   * 客户端只提供加密投影。应在完整 pull 之后调用：本地 replica 此时持有完整树。
   *
   * 数据安全守卫：replica 因解密失败缺行时拒绝执行（reason='replica_incomplete'）。
   * 用残缺投影生成快照 → 服务端截断 ≤ 水位的 op → 解不开的行永久丢失。
   * 换正确密钥（resetCoordinator 重建实例）后水位清零全量重拉，补齐后才能 GC。
   */
  async maybeGc(): Promise<GcResult> {
    if (this.replicaIncomplete) {
      return {
        gced: false,
        deleted: 0,
        snapshot_id: null,
        reason: 'replica_incomplete',
      };
    }
    const projection = this.replica.exportSnapshot();
    const envelope = await encryptJson(projection, this.key, this.spaceId);
    return this.transport.maybeGc(this.spaceId, envelope);
  }
}
