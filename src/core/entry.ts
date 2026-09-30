/**
 * Safari / macOS 复用入口（feat-safari-core-bundle）。
 *
 * 与扩展入口（src/background.ts → src/sync/chromeBridge.ts）的差异：
 *   - 零 chrome.* / DOM / IndexedDB / fetch 依赖，可被 JavaScriptCore 直接加载；
 *   - 运行前提 = 宿主注入三样东西（完整契约见 docs/safari-core-bundle.md）：
 *       ① globalThis.crypto —— getRandomValues / randomUUID / subtle
 *         （AES-GCM 加解密、PBKDF2 派生、importKey/exportKey，Swift 侧用 CryptoKit 桥接）；
 *       ② KVStore —— get / set / remove（Swift 侧 UserDefaults 或文件）；
 *       ③ SupabaseRpcClient —— rpc(fn, args) → { data, error }
 *         （Swift 侧 URLSession 调 POST /rest/v1/rpc/<fn>，绕开 JSCore 缺失的 fetch）；
 *   - btoa / atob（base64url 编解码的硬依赖）由本入口在缺失时以纯 JS polyfill。
 *
 * 构建：`pnpm build:core`（vite.core.config.js，IIFE）→
 *       dist/core/bookmark-sync-core.js（globalThis.BookmarkSyncCore）。
 *
 * 协议零漂移：这里导出的每一行都来自 src/sync 与 src/crdt 的原模块，不做任何
 * 改写 —— 扩展与 macOS App 跑同一份同步引擎，105 单测即引擎的回归防线。
 */

// ── 环境兼容：btoa / atob（JSCore 缺失，纯 JS polyfill，与浏览器语义一致）──

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 浏览器语义的 btoa：输入 latin1 字符串，字符码 >255 抛 InvalidCharacterError。 */
function jsBtoa(binary: string): string {
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const b0 = binary.charCodeAt(i);
    const has1 = i + 1 < binary.length;
    const has2 = i + 2 < binary.length;
    const b1 = has1 ? binary.charCodeAt(i + 1) : 0;
    const b2 = has2 ? binary.charCodeAt(i + 2) : 0;
    if (b0 > 255 || b1 > 255 || b2 > 255) {
      throw new Error('InvalidCharacterError: string contains non-latin1 characters');
    }
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out +=
      B64_CHARS[(triple >> 18) & 63] +
      B64_CHARS[(triple >> 12) & 63] +
      (has1 ? B64_CHARS[(triple >> 6) & 63] : '=') +
      (has2 ? B64_CHARS[triple & 63] : '=');
  }
  return out;
}

/** 浏览器语义的 atob：忽略非法字符与填充位（与浏览器近似，满足 base64url 解码）。 */
function jsAtob(b64: string): string {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_CHARS.indexOf(clean[i]);
    const c1 = B64_CHARS.indexOf(clean[i + 1]);
    const has2 = i + 2 < clean.length;
    const has3 = i + 3 < clean.length;
    const c2 = has2 ? B64_CHARS.indexOf(clean[i + 2]) : 0;
    const c3 = has3 ? B64_CHARS.indexOf(clean[i + 3]) : 0;
    if (c0 < 0 || c1 < 0 || (has2 && c2 < 0) || (has3 && c3 < 0)) continue;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out += String.fromCharCode((triple >> 16) & 255);
    if (has2) out += String.fromCharCode((triple >> 8) & 255);
    if (has3) out += String.fromCharCode(triple & 255);
  }
  return out;
}

if (typeof globalThis.btoa !== 'function') {
  Object.defineProperty(globalThis, 'btoa', { value: jsBtoa, writable: true, configurable: true });
}
if (typeof globalThis.atob !== 'function') {
  Object.defineProperty(globalThis, 'atob', { value: jsAtob, writable: true, configurable: true });
}

// 注入面校验：crypto 必须由宿主提供（JSCore 无 WebCrypto）。
const coreCrypto = (
  globalThis as {
    crypto?: { getRandomValues?: unknown; randomUUID?: unknown; subtle?: unknown };
  }
).crypto;
if (
  !coreCrypto ||
  typeof coreCrypto.getRandomValues !== 'function' ||
  typeof coreCrypto.randomUUID !== 'function' ||
  !coreCrypto.subtle
) {
  throw new Error(
    '[bookmark-sync-core] globalThis.crypto 缺失或不完整：Safari 宿主须先注入 ' +
      'getRandomValues / randomUUID / subtle（契约见 docs/safari-core-bundle.md）',
  );
}

// ── 导出：同步引擎（v2 操作日志 + Move-CRDT + 操作级 E2EE）──

export { SyncCoordinator } from '../sync/syncEngine.js';
export type { SyncCoordinatorOptions, PullOutcome } from '../sync/syncEngine.js';

export { SupabaseOpLogTransport, MemoryOpLogTransport, seqOf } from '../sync/oplogClient.js';
export type {
  OpLogTransport,
  PushOp,
  OpRow,
  PullResult,
  PushResult,
  GcResult,
  SnapshotRow,
  SupabaseRpcClient,
} from '../sync/oplogClient.js';

export { KeyManager } from '../sync/keyManager.js';
export type { KVStore } from '../sync/keyManager.js';

export { encryptMoveOp, decryptMoveOp, encryptJson, decryptJson } from '../sync/opCrypto.js';
export type { EncryptedOpEnvelope } from '../sync/opCrypto.js';

export { Replica } from '../crdt/replica.js';
export type { SnapshotData } from '../crdt/replica.js';
export { apply_op, do_op, redo_op, undo_op, emptyState, logMoveToOp } from '../crdt/moveCrdt.js';
export { ROOT_NODE_ID, TRASH_NODE_ID } from '../crdt/types.js';
export type { CrdtState, Edge, LogMove, Metadata, MoveOp, Timestamp } from '../crdt/types.js';
export { cmpTimestamp, makeTimestamp } from '../crdt/timestamp.js';
export { ancestor, get_parent } from '../crdt/tree.js';
export { positionBetween, evenPositions, compactPositions } from '../crdt/fractionalIndex.js';

// 本地使用（同时保留上面的 re-export 作为公共 API）。
import type { KVStore } from '../sync/keyManager.js';
import type { SupabaseRpcClient } from '../sync/oplogClient.js';
import { KeyManager } from '../sync/keyManager.js';
import { SupabaseOpLogTransport } from '../sync/oplogClient.js';

// E2EE 原语（AES-256-GCM 密钥管理；注意 crdt/crypto/index.ts 的 encryptOp 是 Phase 3
// 老格式，bundle 只带 v2 操作级加密用到的部分）。
export {
  generateKey,
  exportKey,
  importKey,
  deriveFromPassphrase,
  generateSalt,
  bytesToBase64url,
  base64urlToBytes,
  DecryptionError,
} from '../crdt/crypto/index.js';

// ── 宿主注入面与顶层工厂 ────────────────────────────────────────────────

/**
 * macOS App 宿主的注入面（M4 对接契约，见 docs/safari-core-bundle.md）。
 *
 * 说明：`rpc` 用 Swift 的 URLSession 实现而不是注入 fetch —— @supabase/supabase-js
 * 带大量浏览器假设，直接打包进 JSCore 得不偿失；而 `rpc(fn, args)` 是同步引擎
 * 唯一需要的云端入口（bsync_op_push / bsync_op_pull / bsync_snapshot_pull /
 * bsync_op_maybe_gc），Swift 侧几十行即可实现，且天然复用现有 Auth 会话。
 */
export interface CoreHost {
  /** 本地键值存储（密钥 / 盐 / 绑定 / counter / afterId 等持久化）。 */
  kv: KVStore;
  /** Supabase RPC 客户端。 */
  rpc: SupabaseRpcClient;
}

export interface CoreInstance {
  keyManager: KeyManager;
  transport: SupabaseOpLogTransport;
}

/**
 * 顶层工厂：把宿主注入的 kv / rpc 绑定成 keyManager + SupabaseOpLogTransport，
 * 供 Swift 壳组装 SyncCoordinator 使用。
 *
 * 用法（Swift 侧伪代码）：
 *   let core = BookmarkSyncCore.createCore({ kv: userDefaultsStore, rpc: urlSessionRpc });
 *   await core.keyManager.setKeyFromPassphrase(passphrase);
 *   let key = await core.keyManager.ensureKey();
 *   let coordinator = new core.SyncCoordinator({ spaceId, deviceId, transport: core.transport, key });
 */
export function createCore(host: CoreHost): CoreInstance {
  return {
    keyManager: new KeyManager(host.kv),
    transport: new SupabaseOpLogTransport(host.rpc),
  };
}
