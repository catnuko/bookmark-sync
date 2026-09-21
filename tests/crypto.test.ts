/**
 * tests/crypto.test.ts — operation-level E2EE (AES-256-GCM) unit tests.
 *
 * Covers the whole-MoveOp encryption path (src/sync/opCrypto.ts) and key
 * management (src/crdt/crypto/key.ts):
 *   1. encrypt/decrypt roundtrip
 *   2. random IV (same op -> different envelope each time)
 *   3. ciphertext tamper detection
 *   4. IV tamper detection
 *   5. wrong key rejection
 *   6. wrong space (AAD) rejection
 *   7. key export/import roundtrip
 *   8. base64url encode/decode roundtrip
 *   9. PBKDF2 derivation is deterministic (same passphrase+salt -> same key)
 *  10. different salt -> different derived key
 *  11. generateSalt yields 16 random bytes (base64url)
 *  12. DecryptionError is an Error subclass
 *  13. malformed envelope rejected
 *  14. empty-metadata op roundtrips
 *  15. imported wrong-length key is rejected
 *  16. ciphertext is opaque (does not leak plaintext title/url)
 */

import { describe, it, expect } from 'vitest';
import {
  ROOT_NODE_ID,
  generateKey,
  exportKey,
  importKey,
  deriveFromPassphrase,
  generateSalt,
  bytesToBase64url,
  base64urlToBytes,
  DecryptionError,
  type MoveOp,
  type Metadata,
} from '../src/crdt/index.js';
import { encryptMoveOp, decryptMoveOp } from '../src/sync/opCrypto.js';

function makeOp(counter: number, replicaId: string, c: string): MoveOp {
  const m: Metadata = { title: `bookmark-${c}`, url: `https://example.com/${c}` };
  return { t: { counter, replicaId }, p: ROOT_NODE_ID, m, c };
}

const SPACE = '11111111-2222-4333-8444-555555555555';

describe('operation-level E2EE', () => {
  it('1. encrypt -> decrypt roundtrip yields the original MoveOp', async () => {
    const key = await generateKey();
    const op = makeOp(1, 'dev-A', 'node-1');
    const env = await encryptMoveOp(op, key, SPACE);
    const back = await decryptMoveOp(env, key, SPACE);
    expect(back).toEqual(op);
  });

  it('2. fresh IV each call -> same op encrypts to different envelopes', async () => {
    const key = await generateKey();
    const op = makeOp(1, 'dev-A', 'node-1');
    const a = await encryptMoveOp(op, key, SPACE);
    const b = await encryptMoveOp(op, key, SPACE);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('3. tampered ciphertext is rejected', async () => {
    const key = await generateKey();
    const op = makeOp(1, 'dev-A', 'node-1');
    const env = await encryptMoveOp(op, key, SPACE);
    const bad = { ...env, ciphertext: env.ciphertext.slice(0, -4) + 'AAAA' };
    await expect(decryptMoveOp(bad, key, SPACE)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('4. tampered IV is rejected', async () => {
    const key = await generateKey();
    const op = makeOp(1, 'dev-A', 'node-1');
    const env = await encryptMoveOp(op, key, SPACE);
    const bad = { ...env, iv: env.iv.slice(0, -2) + (env.iv.endsWith('A') ? 'B' : 'A') };
    await expect(decryptMoveOp(bad, key, SPACE)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('5. wrong key cannot decrypt', async () => {
    const key = await generateKey();
    const other = await generateKey();
    const env = await encryptMoveOp(makeOp(1, 'a', 'n'), key, SPACE);
    await expect(decryptMoveOp(env, other, SPACE)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('6. wrong space (AAD) cannot decrypt', async () => {
    const key = await generateKey();
    const env = await encryptMoveOp(makeOp(1, 'a', 'n'), key, SPACE);
    await expect(
      decryptMoveOp(env, key, '99999999-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('7. exportKey -> importKey roundtrip', async () => {
    const key = await generateKey();
    const b64 = await exportKey(key);
    const back = await importKey(b64);
    const env = await encryptMoveOp(makeOp(1, 'a', 'n'), key, SPACE);
    expect(await decryptMoveOp(env, back, SPACE)).toEqual(makeOp(1, 'a', 'n'));
  });

  it('8. base64url encode/decode roundtrip preserves bytes', () => {
    const bytes = new Uint8Array([0, 255, 1, 128, 64, 32]);
    const b64 = bytesToBase64url(bytes);
    const back = base64urlToBytes(b64);
    expect(Array.from(back)).toEqual([0, 255, 1, 128, 64, 32]);
  });

  it('9. PBKDF2 derivation is deterministic for (passphrase, salt)', async () => {
    const salt = base64urlToBytes(generateSalt());
    const k1 = await deriveFromPassphrase('hunter2-pass', salt, 100_000);
    const k2 = await deriveFromPassphrase('hunter2-pass', salt, 100_000);
    expect(await exportKey(k1)).toBe(await exportKey(k2));
  });

  it('10. different salt -> different derived key', async () => {
    const s1 = base64urlToBytes(generateSalt());
    const s2 = base64urlToBytes(generateSalt());
    const k1 = await deriveFromPassphrase('same-pass', s1, 100_000);
    const k2 = await deriveFromPassphrase('same-pass', s2, 100_000);
    expect(await exportKey(k1)).not.toBe(await exportKey(k2));
  });

  it('11. generateSalt returns 16 random bytes', () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(base64urlToBytes(a).length).toBe(16);
    expect(a).not.toBe(b);
  });

  it('12. DecryptionError is an Error subclass', () => {
    expect(new DecryptionError('x')).toBeInstanceOf(Error);
    expect(new DecryptionError('x').name).toBe('DecryptionError');
  });

  it('13. malformed envelope rejected', async () => {
    const key = await generateKey();
    // @ts-expect-error intentionally malformed input
    await expect(decryptMoveOp({ iv: 123, ciphertext: 'x' }, key, SPACE)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('14. empty-metadata op roundtrips', async () => {
    const key = await generateKey();
    const op: MoveOp = { t: { counter: 7, replicaId: 'r' }, p: ROOT_NODE_ID, m: {}, c: 'c' };
    const env = await encryptMoveOp(op, key, SPACE);
    expect(await decryptMoveOp(env, key, SPACE)).toEqual(op);
  });

  it('15. a 16-byte (AES-128) key cannot decrypt a 256-bit ciphertext', async () => {
    const real = await generateKey(); // 256-bit
    const env = await encryptMoveOp(makeOp(1, 'a', 'n'), real, SPACE);
    // 16 raw bytes -> WebCrypto derives AES-128, which must fail GCM auth.
    const shortKey = await importKey(Buffer.from(new Uint8Array(16)).toString('base64'));
    await expect(decryptMoveOp(env, shortKey, SPACE)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('16. ciphertext is opaque (no plaintext leak)', async () => {
    const key = await generateKey();
    const secret = 'super-secret-title-xyzzy';
    const op: MoveOp = {
      t: { counter: 1, replicaId: 'r' },
      p: ROOT_NODE_ID,
      m: { title: secret },
      c: 'c',
    };
    const env = await encryptMoveOp(op, key, SPACE);
    expect(env.ciphertext).not.toContain(secret);
    expect(env.iv).not.toContain(secret);
  });
});
