#!/usr/bin/env node
/**
 * 冒烟验证：dist/core/bookmark-sync-core.js 可被「类 JavaScriptCore」环境加载
 * 并跑通整条同步链路（M4 对接前的最后一关）。
 *
 * 做法：用 node:vm 开一个干净沙箱（无 btoa/atob/crypto/TextEncoder —— 与 JSCore
 * 同样的缺失面），先验证「不注入 crypto 必须拒绝加载」，再注入 crypto 桥
 * （模拟 Swift CryptoKit），随后跑：
 *   1. 空沙箱拒绝加载（crypto 缺失校验生效）
 *   2. 注入后加载成功、导出齐全、btoa/atob polyfill 往返正确
 *   3. 双设备 CRDT 同步收敛（A 建节点 → push → B pull 应用）
 *   4. 删除墓碑双向收敛
 *   5. 操作级 E2EE 信封加解密（AAD = spaceId）
 *
 * 用法：pnpm verify:core（= build:core && node scripts/verify-core-bundle.mjs）
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const bundlePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../dist/core/bookmark-sync-core.js',
);
const code = readFileSync(bundlePath, 'utf8');

const SPACE_ID = 'space-00000000-0000-4000-8000-000000000001';

// ── 1. 空沙箱（模拟 JSCore：无 btoa/atob/crypto/TextEncoder）必须拒绝加载 ──
const sandbox = { console, TextEncoder, TextDecoder, setTimeout, clearTimeout };
const ctx = createContext(sandbox);
let bootstrapError = null;
try {
  runInContext(code, ctx);
} catch (e) {
  bootstrapError = e;
}
if (!bootstrapError) {
  throw new Error('FAIL 1/5: 空沙箱加载 bundle 未抛 crypto 缺失错误');
}
if (!String(bootstrapError.message ?? '').includes('crypto 缺失')) {
  throw new Error(`FAIL 1/5: 错误信息不符: ${bootstrapError.message}`);
}
console.log('PASS 1/5  空沙箱拒绝加载（crypto 缺失校验生效）');

// ── 2. 注入 crypto 桥（模拟 Swift CryptoKit）→ 重载成功 ──
sandbox.crypto = {
  getRandomValues: (arr) => webcrypto.getRandomValues(arr),
  randomUUID: () => webcrypto.randomUUID(),
  subtle: webcrypto.subtle,
};
runInContext(code, ctx);
const core = ctx.BookmarkSyncCore;
const expectedExports = [
  'createCore',
  'SyncCoordinator',
  'KeyManager',
  'Replica',
  'MemoryOpLogTransport',
  'SupabaseOpLogTransport',
  'encryptMoveOp',
  'decryptMoveOp',
  'bytesToBase64url',
  'base64urlToBytes',
  'deriveFromPassphrase',
  'ROOT_NODE_ID',
];
for (const name of expectedExports) {
  if (typeof core[name] === 'undefined') {
    throw new Error(`FAIL 2/5: 导出缺失 ${name}`);
  }
}
// btoa/atob 已被 bundle polyfill，base64url 往返必须正确（polyfill 路径）。
const b64 = core.bytesToBase64url(new Uint8Array([1, 2, 3, 250]));
const back = core.base64urlToBytes(b64);
if (back.length !== 4 || back[3] !== 250) {
  throw new Error('FAIL 2/5: base64url polyfill 往返不一致');
}
console.log('PASS 2/5  注入后加载成功，导出齐全，btoa/atob polyfill 往返正确');

// ── 3. 双设备 CRDT 同步收敛 ──
function memKV() {
  const m = new Map();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  };
}
const rpc = {
  rpc: async () => {
    throw new Error('冒烟不应调用云端 rpc（走 MemoryOpLogTransport）');
  },
};
const instA = core.createCore({ kv: memKV(), rpc });
const instB = core.createCore({ kv: memKV(), rpc });
await instA.keyManager.setKeyFromPassphrase('test-passphrase-12345');
const saltA = await instA.keyManager.getSalt();
await instB.keyManager.setSalt(saltA); // 同口令 + 同盐 → 同密钥（云端盐流转语义）
await instB.keyManager.setKeyFromPassphrase('test-passphrase-12345');
const keyA = await instA.keyManager.ensureKey();
const keyB = await instB.keyManager.ensureKey();
if (!keyA || !keyB) throw new Error('FAIL 3/5: 口令派生未产生密钥');

const transport = new core.MemoryOpLogTransport();
const coordA = new core.SyncCoordinator({
  spaceId: SPACE_ID,
  deviceId: 'dev-00000000-0000-4000-8000-00000000000a',
  transport,
  key: keyA,
});
const coordB = new core.SyncCoordinator({
  spaceId: SPACE_ID,
  deviceId: 'dev-00000000-0000-4000-8000-00000000000b',
  transport,
  key: keyB,
});
const roots = coordA.replica.getChildren(core.ROOT_NODE_ID);
const parent = roots[0]?.id;
if (!parent) throw new Error('FAIL 3/5: 根结构缺失（ensureRoots 未生效）');
const nodeId = coordA.createNode(parent, { title: 'Hello Safari', url: 'https://example.com' });
const pushed = await coordA.flushPush();
if (pushed !== 1) throw new Error(`FAIL 3/5: A 推送数=${pushed} 预期 1`);
const outcome = await coordB.pull();
if (outcome.applied !== 1) {
  throw new Error(
    `FAIL 3/5: B 应用 op 数=${outcome.applied} 预期 1（decryptErrors=${JSON.stringify(outcome.decryptErrors)}）`,
  );
}
const found = coordB.replica.getChildren(parent).find((c) => c.id === nodeId);
if (!found || found.meta.title !== 'Hello Safari') {
  throw new Error('FAIL 3/5: B 未收敛到 A 的节点');
}
console.log('PASS 3/5  双设备 CRDT 同步收敛（A 建节点 → push → B pull 应用）');

// ── 4. 删除墓碑双向收敛 ──
coordB.deleteNode(nodeId);
const pushed2 = await coordB.flushPush();
if (pushed2 !== 1) throw new Error(`FAIL 4/5: B 删除推送数=${pushed2} 预期 1`);
const out2 = await coordA.pull();
if (!out2.applied) throw new Error('FAIL 4/5: 删除 op 未回传到 A');
if (coordA.replica.getChildren(parent).some((c) => c.id === nodeId)) {
  throw new Error('FAIL 4/5: 删除墓碑未收敛到 A');
}
console.log('PASS 4/5  删除墓碑双向收敛');

// ── 5. 操作级 E2EE 信封（AAD = spaceId）──
const envelope = await core.encryptMoveOp(
  { t: { counter: 999, replicaId: 'dev-1' }, p: parent, m: { title: 'x' }, c: nodeId },
  keyA,
  SPACE_ID,
);
const dec = await core.decryptMoveOp(envelope, keyB, SPACE_ID);
if (dec.c !== nodeId) throw new Error('FAIL 5/5: 信封加解密失败');
console.log('PASS 5/5  操作级 E2EE 信封加解密（AAD=spaceId）');

console.log('\n✅ verify-core-bundle 全部通过：bundle 可被类 JSCore 环境加载并跑通同步链路');
