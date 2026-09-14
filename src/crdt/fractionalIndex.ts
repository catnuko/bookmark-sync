/**
 * Fractional index for ordering siblings (§3.7, p.7-8).
 *
 * The paper's tree CRDT itself treats children as an UNORDERED set. To get
 * ordered siblings (bookmark bar order) we layer a fractional-index scheme
 * on top: each node's Metadata.position holds a string, and siblings are
 * sorted lexicographically by that string.
 *
 * Alphabet: base-62, "0-9A-Za-z" (0..61).
 *
 * positionBetween(a, b) returns a string s with a < s < b (lexicographic).
 *   - a === null  => s is inserted at the very front (s < b).
 *   - b === null  => s is inserted at the very end (a < s).
 *   - both null   => a middle-of-alphabet seed.
 *
 * Algorithm (per project spec):
 *   Find the first index where a and b differ; pick a midpoint character.
 *   If a is a prefix of b, append a midpoint character after a.
 *   If the two differing characters are adjacent (no integer strictly
 *   between them), extend `a` by a middle character (this still yields
 *   a < s < b because a < b at the first differing position).
 *
 * TODO(design-decision): When two siblings end up with identical
 * position strings (e.g. under extreme fractional-index exhaustion, or
 * if two replicas independently insert between the same two anchors),
 * the UI should break ties by node id. Rationale: fractional index
 * provides dense lexicographic ordering but is not collision-free in the
 * worst case; node ids are globally unique (UUID), so appending them as
 * a secondary sort key yields a deterministic total order without
 * extra CRDT complexity. This matches how react-beautiful-dnd /
 * Firestore field ordering treat identical positions.
 */

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = CHARS.length; // 62
/** A middle-of-alphabet character, used as a neutral filler. */
const HALF = Math.floor(BASE / 2); // 31 -> 'V'

function val(c: string): number {
  const idx = CHARS.indexOf(c);
  if (idx < 0) throw new Error(`fractionalIndex: invalid character "${c}"`);
  return idx;
}

function chr(v: number): string {
  return CHARS[v];
}

/** Produce s < b (b is non-empty). */
function before(b: string): string {
  // Produce s strictly below b.
  if (b.length === 0) {
    // No string is strictly less than "" under lexicographic order. This is
    // reached only under extreme front-insertion exhaustion; return a neutral
    // key. TODO: production code should re-balance positions (re-assign all
    // siblings to fresh keys) when keys get too long / collide.
    return chr(HALF);
  }
  const b0 = val(b[0]);
  if (b0 > 0) {
    // s starts with CHARS[0], which is strictly below b[0]. We append a
    // second char in the lower half to leave room for later insertions.
    return chr(0) + chr(Math.floor(b0 / 2));
  }
  // b[0] === CHARS[0]: s must share that leading char, then be below b's
  // suffix. Recurse. (Repeated front insertions grow the string by one char
  // per ~log2(BASE) steps; extreme exhaustion is handled above.)
  return chr(0) + before(b.slice(1));
}

/**
 * Return a position string s with a < s < b (lexicographic).
 */
export function positionBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`positionBetween: requires a < b, got a="${a}", b="${b}"`);
  }

  if (a === null && b === null) {
    return chr(HALF);
  }
  if (a === null) {
    return before(b!);
  }
  if (b === null) {
    // Append a middle char: a is a proper prefix of s, so a < s.
    return a + chr(HALF);
  }

  // Both non-null, a < b.
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;

  if (i === a.length) {
    // a is a prefix of b.
    const bi = val(b[i]);
    if (bi > 1) {
      return a + chr(Math.floor(bi / 2));
    }
    // bi === 0 or 1: no clean single-char midpoint. Append CHARS[0] + filler;
    // since CHARS[0] <= b[i], and if b[i] === CHARS[0] we rely on the filler
    // making s a proper extension that still sits before b's continuation.
    // TODO(exhaustion): this can collide when b is exactly a+CHARS[0].
    return a + chr(0) + chr(HALF);
  }
  if (i === b.length) {
    // b is a prefix of a — contradicts a < b; treat by extending a.
    return a + chr(HALF);
  }

  const ai = val(a[i]);
  const bi = val(b[i]);
  if (bi - ai > 1) {
    // There is an integer strictly between ai and bi.
    return a.slice(0, i) + chr(Math.floor((ai + bi) / 2));
  }
  // Adjacent characters: no midpoint. Because a[i] < b[i], any extension
  // of a is still < b. Extend a with a filler char.
  return a + chr(HALF);
}

// ── Compaction (Phase 4) ──────────────────────────────────────────────────

/**
 * Produce `n` evenly-spaced, equal-length position strings.
 *
 * We use two base-62 characters (3844 slots) and place each item at the
 * centre of its own bucket. The result is strictly increasing and bounded
 * in length regardless of `n` (for n <= 3844). This is the "rebalance" that
 * recovers from extreme front-insertion exhaustion.
 */
export function evenPositions(n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [chr(HALF)];
  const total = BASE * BASE; // 3844
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = Math.floor(((i + 0.5) / n) * total);
    out.push(chr(Math.floor(v / BASE)) + chr(v % BASE));
  }
  return out;
}

/**
 * Re-assign evenly-distributed positions to the direct children of
 * `parentId`, preserving their CURRENT order (sorted by position, ties by
 * node id). Each child is moved with a fresh meta that only changes
 * `position`, so this propagates as ordinary MoveOps through sync.
 *
 * Call when sibling positions have grown too long (e.g. > 32 chars) or when
 * front-insertion can no longer allocate a new key.
 *
 * @returns the freshly assigned positions (in child order).
 */
import type { Replica } from './replica.js';
export function compactPositions(replica: Replica, parentId: string): string[] {
  const kids = replica
    .getChildren(parentId)
    .slice()
    .sort((a, b) => {
      const pa = String(a.meta.position ?? '');
      const pb = String(b.meta.position ?? '');
      if (pa !== pb) return pa < pb ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  const positions = evenPositions(kids.length);
  for (let i = 0; i < kids.length; i++) {
    const meta = { ...kids[i].meta, position: positions[i] };
    replica.moveNode(kids[i].id, parentId, meta);
  }
  return positions;
}
