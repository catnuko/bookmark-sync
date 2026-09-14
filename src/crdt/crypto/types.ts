/**
 * Shared types for the Phase 3 E2EE layer.
 *
 * The wire format of an encrypted DAG node's `payload` field is a JSON
 * string of this object:
 *
 *   { "iv": "<base64url(12-byte IV)>",
 *     "ciphertext": "<base64url(AES-GCT output incl. 16-byte tag)>" }
 *
 * Both fields are base64url (URL-safe, no padding) so the whole thing is a
 * single opaque JSON string that can be dropped into MerkleNode.payload.
 * The CID covers this string verbatim — see src/sync/cid.ts.
 */

/**
 * Encrypted form of a MoveOp.
 *
 * - `iv`         : 96-bit (12-byte) random IV, regenerated on EVERY encryption
 *                  call. Never reuse an IV with the same key (GCM catastrophe).
 * - `ciphertext` : AES-256-GCM output. WebCrypto APPENDS the 16-byte
 *                  authentication tag to the ciphertext automatically, so we
 *                  do NOT store a separate tag field.
 *
 * The Additional Authenticated Data (AAD) — the sorted parent CIDs — is NOT
 * stored here. It is recomputed from the DAG position (node.parents) at
 * decrypt time. Tampering with the parents changes the AAD and therefore
 * makes authentication fail.
 */
export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

/**
 * Raised when an encrypted payload cannot be authenticated/decrypted:
 * wrong key, tampered ciphertext, tampered IV, wrong AAD (replay under a
 * different parent set), or malformed JSON.
 *
 * It is intentionally a plain Error subclass so callers can `instanceof`
 * it. Callers (SyncClient) catch it, console.warn, and SKIP the node — they
 * never rethrow, so a single corrupt node cannot stall the sync pipeline.
 */
export class DecryptionError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DecryptionError';
    // Preserve cause across ES targets without relying on super(message, {cause}).
    this.cause = cause;
  }
}
