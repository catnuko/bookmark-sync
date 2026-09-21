/**
 * Operation-level E2EE for the CRDT op log (v2 contract).
 *
 * Per the v2 schema (docs/migrations/20260914_v2_move_crdt.sql), bsync_op_log.op
 * is a JSONB column. We store an encrypted ENVELOPE object:
 *
 *   { "iv": "<base64url(12B IV)>", "ciphertext": "<base64url(AES-256-GCM || tag)>" }
 *
 * rather than a plaintext MoveOp. This is operation-level E2EE (the whole
 * MoveOp — parent, metadata, child id, timestamp — is encrypted at once), in
 * contrast to the old field-level crypto.js which only obfuscated title/url.
 *
 * The envelope is a JSON object, so it drops straight into the JSONB `op`
 * column without serialization surprises. Supabase sees only opaque blobs plus
 * op_log's non-secret columns (space_id, device_id, seq, cid, created_at).
 *
 * AAD = UTF-8(space_id). It binds the ciphertext to its space so a blob cannot
 * be transplanted into another tenant's space (tamper-evidence; the space_id is
 * already public metadata, so no new information leaks).
 */

import type { MoveOp } from '../crdt/index.js';
import { DecryptionError, bytesToBase64url, base64urlToBytes } from '../crdt/index.js';

/** The shape stored in bsync_op_log.op (JSONB). */
export interface EncryptedOpEnvelope {
  iv: string;
  ciphertext: string;
}

function aadFor(spaceId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(spaceId) as Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt a whole MoveOp into the JSONB envelope that becomes bsync_op_log.op.
 *
 * @param op      the CRDT operation (JSON stringified, then AES-256-GCM).
 * @param key     the shared AES-256-GCM CryptoKey.
 * @param spaceId the space this op belongs to (bound as AAD).
 */
export async function encryptMoveOp(
  op: MoveOp,
  key: CryptoKey,
  spaceId: string,
): Promise<EncryptedOpEnvelope> {
  return encryptJson(op, key, spaceId);
}

/**
 * Decrypt a JSONB envelope back into a MoveOp.
 * @throws DecryptionError on wrong key / tamper / wrong space / malformed envelope.
 */
export async function decryptMoveOp(
  envelope: EncryptedOpEnvelope,
  key: CryptoKey,
  spaceId: string,
): Promise<MoveOp> {
  return decryptJson<MoveOp>(envelope, key, spaceId);
}

/** Encrypt any JSON-serializable payload (GC snapshots etc.) into the same envelope. */
export async function encryptJson(
  data: unknown,
  key: CryptoKey,
  spaceId: string,
): Promise<EncryptedOpEnvelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(spaceId) },
    key,
    plaintext,
  );
  return {
    iv: bytesToBase64url(iv),
    ciphertext: bytesToBase64url(new Uint8Array(cipher)),
  };
}

/** Decrypt a JSONB envelope into a typed value. @throws DecryptionError. */
export async function decryptJson<T>(
  envelope: EncryptedOpEnvelope,
  key: CryptoKey,
  spaceId: string,
): Promise<T> {
  if (!envelope || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new DecryptionError('op envelope missing iv/ciphertext strings');
  }
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64urlToBytes(envelope.iv);
    ciphertext = base64urlToBytes(envelope.ciphertext);
  } catch (e) {
    throw new DecryptionError('op envelope base64url decode failed', e);
  }
  try {
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadFor(spaceId) },
      key,
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch (e) {
    throw new DecryptionError('AES-GCM auth failed (wrong key, tamper, or space mismatch)', e);
  }
}
