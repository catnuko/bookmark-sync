/**
 * AES-256-GCM encryption / decryption of MoveOp payloads (Phase 3 E2EE).
 *
 * Design summary:
 *
 *   encryptOp(op, key, parents) -> JSON.stringify(EncryptedPayload)
 *     - plaintext  = UTF-8(JSON.stringify(op))
 *     - IV         = crypto.getRandomValues(12 bytes), fresh EVERY call
 *     - AAD        = UTF-8(JSON.stringify(sorted(parents)))
 *     - ciphertext = AES-GCM(key, iv, plaintext, AAD)  (tag appended)
 *
 *   decryptPayload(blob, key, parents) -> MoveOp
 *     - re-derives the SAME AAD from `parents`
 *     - WebCrypto fails the decrypt if the tag does NOT verify, which covers
 *       tampered ciphertext, tampered IV, wrong key, OR wrong AAD (replay
 *       under a different parent set).
 *
 * Why AAD = sorted parents:
 *   The parents CIDs are NOT secret, but binding them into the
 *   authentication means a node cannot be transplanted (replayed) under a
 *   different parent set. Without AAD, a man-in-the-middle could copy a
 *   validly-encrypted node and attach it as a child of a different node;
 *   with AAD, the re-parented copy fails authentication. This is what makes
 *   the Merkle-DAG position tamper-evident end-to-end.
 *
 * Security notes:
 *   - IV is always 12 bytes and fresh. NEVER reuse (IV, key) pairs.
 *   - GCM tag is 16 bytes and is appended by WebCrypto; we do not store it
 *     separately.
 *   - The key is consumed via CryptoKey and never logged here.
 */

import type { MoveOp } from '../types.js';
import { DecryptionError } from './types.js';
import { base64urlToBytes, bytesToBase64url } from './key.js';

/**
 * Compute the Additional Authenticated Data for a node given its parents.
 * Deterministic: the same parent SET always yields the same AAD bytes,
 * regardless of the order the parents were passed in.
 */
function aadFor(parents: string[]): Uint8Array<ArrayBuffer> {
  const canonical = JSON.stringify([...parents].sort());
  return new TextEncoder().encode(canonical) as Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt a MoveOp into the encrypted-payload JSON string that becomes
 * MerkleNode.payload.
 *
 * @param op      the CRDT operation to encrypt.
 * @param key     the shared AES-256-GCM CryptoKey.
 * @param parents the DAG parent CIDs at creation time (bound as AAD).
 * @returns JSON.stringify({ iv, ciphertext }).
 */
export async function encryptOp(op: MoveOp, key: CryptoKey, parents: string[]): Promise<string> {
  // Fresh 96-bit IV on every call. GCM mandates a unique (key, IV) pair.
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(op));

  const cipherBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(parents) },
    key,
    plaintext,
  );

  const out = {
    iv: bytesToBase64url(iv),
    ciphertext: bytesToBase64url(new Uint8Array(cipherBuffer)),
  };
  return JSON.stringify(out);
}

/**
 * Decrypt an encrypted-payload JSON string back into a MoveOp.
 *
 * @param payload the MerkleNode.payload string (JSON of EncryptedPayload).
 * @param key    the shared AES-256-GCM CryptoKey.
 * @param parents the node's DAG parent CIDs (re-derived as AAD).
 * @throws DecryptionError on any authentication failure or malformed input.
 */
export async function decryptPayload(
  payload: string,
  key: CryptoKey,
  parents: string[],
): Promise<MoveOp> {
  // 1. Parse the envelope.
  let envelope: { iv: unknown; ciphertext: unknown };
  try {
    envelope = JSON.parse(payload) as { iv: unknown; ciphertext: unknown };
  } catch (e) {
    throw new DecryptionError('payload is not valid JSON', e);
  }
  if (typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new DecryptionError('payload JSON missing iv/ciphertext strings');
  }

  // 2. Base64url-decode IV + ciphertext.
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    iv = base64urlToBytes(envelope.iv);
    ciphertext = base64urlToBytes(envelope.ciphertext);
  } catch (e) {
    throw new DecryptionError('failed to base64url-decode iv/ciphertext', e);
  }

  // 3. Authenticate + decrypt. Any mismatch (wrong key, tampering, wrong
  //    parents/AAD) surfaces as a WebCrypto OperationError, which we wrap.
  try {
    const plainBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aadFor(parents) },
      key,
      ciphertext,
    );
    const text = new TextDecoder().decode(plainBuffer);
    return JSON.parse(text) as MoveOp;
  } catch (e) {
    throw new DecryptionError(
      'AES-GCM authentication failed (wrong key, tampered bytes, or AAD/parent mismatch)',
      e,
    );
  }
}
