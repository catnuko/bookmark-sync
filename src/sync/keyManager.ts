/**
 * Key management for operation-level E2EE (Phase C-2).
 *
 * The raw 32-byte AES-256-GCM key is persisted in chrome.storage.local of THIS
 * device. It never leaves the device except when the user explicitly exports
 * it (or derives it from a passphrase shared out-of-band).
 *
 * Passphrase derivation uses a RANDOM per-user salt (not the old fixed salt).
 * The salt is stored alongside the key and is not secret — it just makes
 * rainbow-table / cross-user dictionary attacks useless.
 *
 * Storage is injected so this module stays testable under Node.
 */

import {
  generateKey,
  exportKey,
  importKey,
  deriveFromPassphrase,
  generateSalt,
  bytesToBase64url,
  base64urlToBytes,
} from '../crdt/index.js';

/** Minimal async key-value storage (chrome.storage.local in production). */
export interface KVStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const KEY_KEY = 'crdt.e2eeKey'; // base64url(32 raw bytes)
const SALT_KEY = 'crdt.e2eeSalt'; // base64url(16 random bytes)

export class KeyManager {
  constructor(private readonly store: KVStore) {}

  /** True if this device already has a key. */
  async hasKey(): Promise<boolean> {
    return !!(await this.store.get(KEY_KEY));
  }

  /** Ensure a key exists; generate a fresh random one if not. Returns the CryptoKey. */
  async ensureKey(): Promise<CryptoKey> {
    const existing = await this.store.get(KEY_KEY);
    if (existing) return importKey(existing);
    const key = await generateKey();
    await this.store.set(KEY_KEY, await exportKey(key));
    // A fresh random salt accompanies a freshly generated key.
    await this.store.set(SALT_KEY, generateSalt());
    return key;
  }

  /** Export the raw key as base64url (for a user to paste on another device). */
  async exportKey(): Promise<string> {
    const existing = await this.store.get(KEY_KEY);
    if (existing) return existing;
    const key = await this.ensureKey();
    return exportKey(key);
  }

  /** Import a base64url key from another device. Returns true on success. */
  async importKey(b64: string): Promise<boolean> {
    const trimmed = (b64 ?? '').trim();
    if (!trimmed) return false;
    try {
      const bytes = base64urlToBytes(trimmed);
      if (bytes.length !== 32) return false;
      // Validate it imports as an AES-GCM key before persisting.
      await importKey(trimmed);
      await this.store.set(KEY_KEY, trimmed);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Derive (or re-derive) the key from a passphrase + the stored random salt.
   * On first use, if no salt exists, generate one. Returns false if the
   * passphrase is too weak.
   */
  async setKeyFromPassphrase(passphrase: string): Promise<boolean> {
    const text = String(passphrase ?? '');
    if (text.length < 8) return false;
    let saltB64 = await this.store.get(SALT_KEY);
    if (!saltB64) {
      saltB64 = generateSalt();
      await this.store.set(SALT_KEY, saltB64);
    }
    const salt = base64urlToBytes(saltB64);
    const key = await deriveFromPassphrase(text, salt, 210_000);
    await this.store.set(KEY_KEY, await exportKey(key));
    return true;
  }

  /** The random per-user salt (public; share it so other devices can derive). */
  async getSalt(): Promise<string | null> {
    return (await this.store.get(SALT_KEY)) ?? null;
  }

  /** Import a salt from another device (needed to derive the same key). */
  async setSalt(saltB64: string): Promise<void> {
    await this.store.set(SALT_KEY, saltB64);
  }
}

/** Re-export for convenience. */
export { bytesToBase64url, base64urlToBytes };
