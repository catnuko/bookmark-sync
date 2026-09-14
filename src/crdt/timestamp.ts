import type { Timestamp } from './types.js';

/**
 * Total order on Lamport timestamps (§5.1, p.9).
 *
 * First compare `counter` numerically; if equal, break the tie by
 * `replicaId` lexicographically. This guarantees a total order even when
 * two replicas independently increment their counters to the same value.
 *
 * Returns -1 if a < b, 0 if a === b, +1 if a > b.
 */
export function cmpTimestamp(a: Timestamp, b: Timestamp): number {
  if (a.counter !== b.counter) {
    return a.counter < b.counter ? -1 : 1;
  }
  if (a.replicaId === b.replicaId) return 0;
  return a.replicaId < b.replicaId ? -1 : 1;
}

/** Build a timestamp. (Separated for symmetry / future injection.) */
export function makeTimestamp(counter: number, replicaId: string): Timestamp {
  return { counter, replicaId };
}
