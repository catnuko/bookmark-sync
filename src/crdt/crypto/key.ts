/**
 * Key management for the Phase 3 E2EE layer.
 *
 * All keys are AES-256-GCM. There are exactly three ways to obtain a
 * CryptoKey:
 *
 *   1. generateKey()               — fresh random key (creator of a room).
 *   2. importKey(base64url)        — from an invite link `k=` parameter.
 *   3. deriveFromPassphrase(...)   — PBKDF2 passphrase-derived key.
 *
 * Key transport rules (see security notes in aesGcm.ts):
 *   - The CryptoKey is NEVER logged, never serialized into a commit, and
 *     never persisted to localStorage/IndexedDB by this module. The caller
 *     decides storage policy.
 *   - The raw key material (32 bytes) only ever leaves the device inside a
 *     URL fragment (#k=...), which browsers do NOT send to any server.
 */

// ── base64url helpers (pure, works in Node 22 and Chrome MV3) ────────────

/**
 * Encode raw bytes to unpadded base64url (URL-safe).
 * Uses the platform `btoa` on a latin1 intermediate string so we never
 * depend on Node's Buffer (which does not exist in a service worker).
 */
export function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode an unpadded (or padded) base64url string back to raw bytes.
 * Accepts both base64url and standard base64 input.
 */
export function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (b64.length % 4)) % 4;
  const binary = atob(b64 + '='.repeat(pad));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── Key generation / export / import ──────────────────────────────────────

const AES_GCM: AesKeyAlgorithm = { name: 'AES-GCM', length: 256 };

/**
 * Generate a fresh random 256-bit AES-GCM key (extractable, usages encrypt/decrypt).
 * The caller shares this key out-of-band (invite link) — it never touches
 * the relay.
 */
export async function generateKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(AES_GCM, true, ['encrypt', 'decrypt']);
}

/**
 * Export the raw 32-byte key as unpadded base64url.
 * This is the exact string that goes into an invite link's `k=` parameter.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await globalThis.crypto.subtle.exportKey('raw', key);
  return bytesToBase64url(new Uint8Array(raw));
}

/**
 * Import a raw 32-byte key from its base64url form (as produced by exportKey).
 */
export async function importKey(keyBase64url: string): Promise<CryptoKey> {
  const raw = base64urlToBytes(keyBase64url);
  return globalThis.crypto.subtle.importKey('raw', raw, AES_GCM, true, ['encrypt', 'decrypt']);
}

// ── Passphrase derivation (PBKDF2) ────────────────────────────────────────

/**
 * Derive an AES-256-GCM key from a human-readable passphrase.
 *
 * PBKDF2-HMAC-SHA-256, configurable iteration count (default 100000).
 *
 * The salt MUST be random and generated per-room (generateSalt()) and
 * stored/sent alongside the ciphertext or in the invite link — it is NOT
 * secret. Reusing the same (passphrase, salt) pair reproduces the same key,
 * which is exactly what lets every device in the room derive the identical
 * key. Using a fresh random salt per room makes a different passphrase
 * "lookup" useless across rooms.
 *
 * TODO(design): 100000 iterations is a reasonable starting point but should be
 * tuned on the target (browser) CPU and ideally upgraded per-device. A
 * production client may also want Argon2id (not available in WebCrypto).
 */
export async function deriveFromPassphrase(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = 100_000,
): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as Uint8Array<ArrayBuffer>,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    AES_GCM,
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generate a random 16-byte PBKDF2 salt, returned as base64url.
 * Store this next to the ciphertext / in the invite link — it is public.
 */
export function generateSalt(): string {
  return bytesToBase64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}
