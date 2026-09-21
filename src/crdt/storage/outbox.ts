/**
 * 未推送操作的持久化发件箱（outbox，Phase C-3 加固）。
 *
 * 背景：SyncCoordinator.pendingPush 只存在于 SW 内存。MV3 Service Worker
 * 空闲约 30 秒即被回收；推送失败（网关 413/超时/网络抖动/配额拒绝）+ 回收
 * 会让整批本地 op 静默丢失——而 chromeId↔uuid 映射已先一步落盘，下一轮
 * 同步的 removeTrashedNodes 会把「有映射但 CRDT 不可达」的书签从浏览器里
 * 删掉（批量导入的书签因此从本机消失）。
 *
 * 不变式：outbox 里的行 = 尚未确认推送成功的本地 op。
 *   - 入队：op 进 pendingPush 的同一持久化 tick 内成对落盘（与 IDMAP/counter
 *     同 tick；outbox 先写、IDMAP 后写——崩溃窗口的最坏情况是重复书签而非
 *     误删，见 sync.js flushPersist 注释）。
 *   - 确认：每块推送成功后按 seq 删除；漏删无碍——重复推送由服务端
 *     (space_id, device_id, seq) 幂等去重。
 *   - 恢复：SW 冷启动按 spaceId 载入（loadSpace → restoreOutbox），
 *     receiveOp 幂等重放进 replica 并重回推送队列。
 */

import { INDEX_BY_SPACE, STORE_OUTBOX } from './schema.js';
import { txDone } from './uuidMapping.js';
import type { MoveOp } from '../types.js';

export interface OutboxRow {
  /** `${spaceId}:${seq}`，天然幂等（同 op 重复 put 覆盖）。 */
  key: string;
  spaceId: string;
  /** op.t.counter，即推送侧的 seq。 */
  seq: number;
  op: MoveOp;
}

export function outboxKey(spaceId: string, seq: number): string {
  return `${spaceId}:${seq}`;
}

/** Persists unpushed local ops. Construct with an open IDBDatabase. */
export class OutboxStore {
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  /** 幂等写入（put 覆盖同 key）；一次事务批量提交。 */
  async putOps(spaceId: string, ops: MoveOp[]): Promise<void> {
    if (ops.length === 0) return;
    const tx = this.db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    for (const op of ops) {
      const seq = op.t.counter;
      const row: OutboxRow = { key: outboxKey(spaceId, seq), spaceId, seq, op };
      store.put(row);
    }
    await txDone(tx);
  }

  /** 推送确认后按 seq 删除（漏删由服务端幂等去重兜底）。 */
  async deleteSeqs(spaceId: string, seqs: number[]): Promise<void> {
    if (seqs.length === 0) return;
    const tx = this.db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    for (const seq of seqs) {
      store.delete(outboxKey(spaceId, seq));
    }
    await txDone(tx);
  }

  /** 按空间载入全部未确认行（SW 冷启动恢复用，seq 升序）。 */
  async loadSpace(spaceId: string): Promise<OutboxRow[]> {
    const tx = this.db.transaction(STORE_OUTBOX, 'readonly');
    const rows = await new Promise<OutboxRow[]>((resolve, reject) => {
      const req = tx.objectStore(STORE_OUTBOX).index(INDEX_BY_SPACE).getAll(spaceId);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
    });
    return rows.sort((a, b) => a.seq - b.seq);
  }
}
