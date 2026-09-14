/**
 * tests/sync/keyManager.test.ts — 口令模式（PBKDF2 + 共享盐）跨设备一致性。
 *
 * 口令模式的正确性契约（迁移 0019 后成立）：
 *   设备 A：setKeyFromPassphrase(p)  → 生成随机盐 s_A，派生密钥 K_A
 *   设备 B：setSalt(s_A) + setKeyFromPassphrase(p) → 派生同一密钥 K_A
 *   ⇒ 两设备用同一口令即可解密同一份云端密文，无需传递 44 字符密钥。
 *   反例：B 用自己新生成的盐（不同盐）→ 派生不同密钥 → 无法解密。
 */

import { describe, it, expect } from 'vitest';
import { KeyManager, type KVStore } from '../../src/sync/index.js';
import { exportKey } from '../../src/crdt/index.js';

function memKV(): KVStore {
  const m = new Map<string, string>();
  return {
    async get(k) { return m.get(k); },
    async set(k, v) { m.set(k, v); },
    async remove(k) { m.delete(k); },
  };
}

describe('KeyManager 口令模式（跨设备盐流转）', () => {
  it('同口令 + 共享盐 → 两设备派生出同一密钥', async () => {
    // 设备 A：首次设口令，自动生成随机盐
    const a = new KeyManager(memKV());
    expect(await a.setKeyFromPassphrase('correct horse battery')).toBe(true);
    const saltA = await a.getSalt();
    expect(saltA).toBeTruthy();
    const keyA = await a.exportKey();

    // 设备 B：导入 A 的盐（云端同步语义）→ 输入同一口令
    const b = new KeyManager(memKV());
    await b.setSalt(saltA!);
    expect(await b.setKeyFromPassphrase('correct horse battery')).toBe(true);
    expect(await b.exportKey()).toBe(keyA);
  });

  it('不同盐 → 同一口令派生出不同密钥（B 未同步盐时的旧行为）', async () => {
    const a = new KeyManager(memKV());
    await a.setKeyFromPassphrase('same passphrase here');
    const keyA = await a.exportKey();

    // B 没有 A 的盐，直接输入口令 → 生成本地新盐 → 密钥不同
    const b = new KeyManager(memKV());
    expect(await b.setKeyFromPassphrase('same passphrase here')).toBe(true);
    expect(await b.exportKey()).not.toBe(keyA);
  });

  it('同设备重复设口令（无换口令语义）盐保持稳定', async () => {
    const km = new KeyManager(memKV());
    await km.setKeyFromPassphrase('stable passphrase');
    const salt1 = await km.getSalt();
    const key1 = await km.exportKey();
    // 再次输入同一口令：盐已存在 → 不重新生成 → 密钥不变
    expect(await km.setKeyFromPassphrase('stable passphrase')).toBe(true);
    expect(await km.getSalt()).toBe(salt1);
    expect(await km.exportKey()).toBe(key1);
  });

  it('弱口令（<8 位）被拒绝且不改动既有密钥', async () => {
    const km = new KeyManager(memKV());
    await km.setKeyFromPassphrase('a long enough passphrase');
    const keyBefore = await km.exportKey();
    expect(await km.setKeyFromPassphrase('short')).toBe(false);
    expect(await km.exportKey()).toBe(keyBefore);
  });

  it('importKey/exportKey 往返（44 字符密钥导入路径不回归）', async () => {
    const a = new KeyManager(memKV());
    await a.setKeyFromPassphrase('roundtrip passphrase 1');
    const b64 = await a.exportKey();

    const b = new KeyManager(memKV());
    expect(await b.importKey(b64)).toBe(true);
    expect(await b.exportKey()).toBe(b64);
    expect(await b.importKey('not-a-valid-key')).toBe(false);
  });

  it('exportKey 惰性确保密钥存在（未设口令时导出即生成）', async () => {
    const km = new KeyManager(memKV());
    const b64 = await km.exportKey();
    expect(b64).toBeTruthy();
    expect((await km.exportKey())).toBe(b64);
  });

  it('派生密钥长度与格式：AES-256（32 原始字节 → 43 字符 base64url）', async () => {
    const km = new KeyManager(memKV());
    await km.setKeyFromPassphrase('format check passphrase');
    const b64 = await km.exportKey();
    expect(b64).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exportKey).toBeTypeOf('function');
  });
});
