/**
 * Replica <-> IndexedDB persistence (Phase 1).
 *
 * Two-tier persistence:
 *   - `ops` store: every local MoveOp, keyed by `opKey`. High-frequency
 *     writes (one per local user action), idempotent.
 *   - `snapshot` store: one row with the full CrdtState (log + tree),
 *     counter, replicaId and opCount. Low-frequency (a checkpoint).
 *
 * Recovery:
 *   1. Load the snapshot row -> rebuild CrdtState and counter.
 *   2. Read every op whose `t.counter` > snapshot.counter (range query on
 *      the by_timestamp index), sort by (counter, replicaId) ascending,
 *      and `receiveOp` each. Because apply_op is order-agnostic for the
 * *final* tree, the result equals a fresh in-memory Replica.
 *
 * All writes are idempotent: opKey is the primary key, so re-appending the
 * same op overwrites rather than duplicating.
 */

import type { CrdtState, LogMove, MoveOp } from '../types.js';
import { Replica } from '../replica.js';
import { cmpTimestamp } from '../timestamp.js';
import { SNAPSHOT_KEY, STORE_OPS, STORE_SNAPSHOT, opKey } from './schema.js';
import { txDone } from './uuidMapping.js';

/** A row in the `ops` store. */
export interface OpRow extends MoveOp {
  opKey: string;
}

/** Serialized form of CrdtState (Map -> array for structured clone). */
export interface SerializedState {
  log: LogMove[];
  /** [[child, {parent, meta}], ...] */
  tree: Array<[string, { parent: string; meta: Record<string, unknown> }]>;
}

/** The single row in the `snapshot` store. */
export interface SnapshotRow {
  id: typeof SNAPSHOT_KEY;
  state: SerializedState;
  counter: number;
  replicaId: string;
  /** Number of ops persisted up to and including this snapshot. */
  opCount: number;
}

/** Default number of unsnapshotted ops before saveReplica writes a snapshot. */
export const DEFAULT_SNAPSHOT_THRESHOLD = 100;

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
  });
}

/** Serialize a CrdtState (tree Map -> array). */
export function serializeState(state: CrdtState): SerializedState {
  return {
    log: state.log.map((l) => ({ ...l })),
    tree: [...state.tree.entries()] as SerializedState['tree'],
  };
}

/** Inverse of serializeState. */
export function deserializeState(serialized: SerializedState): CrdtState {
  return {
    log: serialized.log.map((l) => ({ ...l })),
    tree: new Map(serialized.tree.map(([child, entry]) => [child, { ...entry }])),
  };
}

/**
 * Persists a Replica's ops + snapshots. Construct with an open IDBDatabase.
 */
export class ReplicaStateStore {
  private readonly db: IDBDatabase;
  private readonly snapshotThreshold: number;

  constructor(db: IDBDatabase, snapshotThreshold: number = DEFAULT_SNAPSHOT_THRESHOLD) {
    this.db = db;
    this.snapshotThreshold = snapshotThreshold;
  }

  /** Append a single op (idempotent). High-frequency; do not await for latency. */
  async appendOp(op: MoveOp): Promise<void> {
    const row: OpRow = { ...op, opKey: opKey(op.t.counter, op.t.replicaId) };
    const tx = this.db.transaction(STORE_OPS, 'readwrite');
    await reqPromise(tx.objectStore(STORE_OPS).put(row));
    await txDone(tx);
  }

  /**
   * Append all ops newer than the last snapshot, then write a fresh snapshot
   * if enough ops have accumulated since the last checkpoint.
   */
  async saveReplica(replica: Replica): Promise<void> {
    const allOps = replica.getOps();
    const snap = await this.readSnapshot();
    const persistedOpCount = snap ? snap.opCount : 0;

    const newOps = allOps.slice(persistedOpCount);
    for (const op of newOps) {
      await this.appendOp(op);
    }

    const unsnapshotted = allOps.length - persistedOpCount;
    if (!snap || unsnapshotted >= this.snapshotThreshold) {
      await this.saveSnapshot(replica);
    }
  }

  /**
   * Full checkpoint: serialize the whole CrdtState + counter + opCount.
   * Low-frequency; call manually or every `snapshotThreshold` ops.
   */
  async saveSnapshot(replica: Replica): Promise<void> {
    const row: SnapshotRow = {
      id: SNAPSHOT_KEY,
      state: serializeState(replica.state),
      counter: replica.counter,
      replicaId: replica.replicaId,
      opCount: replica.getOps().length,
    };
    const tx = this.db.transaction(STORE_SNAPSHOT, 'readwrite');
    await reqPromise(tx.objectStore(STORE_SNAPSHOT).put(row));
    await txDone(tx);
  }

  /** Read the current snapshot row, or null if none exists. */
  async readSnapshot(): Promise<SnapshotRow | null> {
    const tx = this.db.transaction(STORE_SNAPSHOT, 'readonly');
    const row = await reqPromise<SnapshotRow | undefined>(
      tx.objectStore(STORE_SNAPSHOT).get(SNAPSHOT_KEY),
    );
    return row ?? null;
  }

  /**
   * Rebuild a Replica from disk: snapshot + replay of ops newer than the
   * snapshot's counter. If no snapshot exists, replays every persisted op.
   */
  async loadReplica(): Promise<Replica> {
    const snap = await this.readSnapshot();

    if (!snap) {
      // No checkpoint yet: replay every persisted op into a fresh Replica.
      const all = await this.getAllOps();
      if (all.length === 0) {
        // Need a replicaId; the adapter owns it, but loadReplica must return
        // something. Callers that have no snapshot should use
        // loadReplicaWithId(replicaId) instead; here we fall back to a
        // placeholder. TODO(design): see loadReplicaWithId.
        const r = new Replica('__unknown__');
        for (const op of all) r.receiveOp(op);
        return r;
      }
      const replicaId = all[0].t.replicaId;
      const r = new Replica(replicaId);
      for (const op of all) r.receiveOp(op);
      return r;
    }

    // Rebuild from snapshot.
    const replica = new Replica(snap.replicaId);
    replica.state = deserializeState(snap.state);
    replica.counter = snap.counter;

    // Replay ops with counter > snapshot.counter.
    const newer = await this.getOpsAfter(snap.counter);
    for (const op of newer) {
      replica.receiveOp(op);
    }
    return replica;
  }

  /** All persisted ops, sorted by timestamp ascending. */
  async getAllOps(): Promise<MoveOp[]> {
    const tx = this.db.transaction(STORE_OPS, 'readonly');
    const rows = await reqPromise<OpRow[]>(tx.objectStore(STORE_OPS).getAll());
    return rows.map(({ opKey: _opKey, ...op }) => op).sort((a, b) => cmpTimestamp(a.t, b.t));
  }

  /** Ops whose t.counter > `minCounter`, sorted by timestamp ascending. */
  async getOpsAfter(minCounter: number): Promise<MoveOp[]> {
    const tx = this.db.transaction(STORE_OPS, 'readonly');
    const index = tx.objectStore(STORE_OPS).index('by_timestamp');
    // IDBKeyRange.lowerBound(exclusive=true) -> strictly greater.
    const range = IDBKeyRange.lowerBound(minCounter, true);
    const rows = await reqPromise<OpRow[]>(index.getAll(range));
    return rows.map(({ opKey: _opKey, ...op }) => op).sort((a, b) => cmpTimestamp(a.t, b.t));
  }
}
