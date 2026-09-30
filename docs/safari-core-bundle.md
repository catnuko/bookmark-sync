# Safari / macOS 复用 Bundle —— 注入面契约（M4 对接文档）

> 分支：`feat-safari-core-bundle`（L1 产物）
> 对应：`docs/safari-sync-research.md` §5 方案 2（原生菜单栏 App + JavaScriptCore 内嵌现有 TS 同步引擎）
> 一句话：**macOS App 跑的就是扩展用的同一份同步引擎**，本 bundle 提供该引擎的「无浏览器依赖」形态，Swift 壳只负责三件事——注入 `crypto`、注入 `KVStore`、注入 `SupabaseRpcClient`。

## 1. 构建与产物

```bash
pnpm build:core        # vite --config vite.core.config.js → dist/core/bookmark-sync-core.js
pnpm verify:core       # = build:core + scripts/verify-core-bundle.mjs（类 JSCore 沙箱冒烟，5/5）
```

- 产物：`dist/core/bookmark-sync-core.js`（IIFE，约 19KB / gzip 6.5KB），挂 `globalThis.BookmarkSyncCore`。
- 与主构建完全隔离：不触 `post-build-safari.mjs`，不带 `public/`，不发 sourcemap。
- 已验证产物**无** `indexedDB` / `chrome.` 标识符残留（tree-shake 生效）。

## 2. 运行前提（Swift 壳在加载 bundle 前必须完成的注入）

### 2.1 `globalThis.crypto`（必注入；JSCore 无 WebCrypto）

| 成员                          | 签名                                                                 | Swift 实现                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `getRandomValues(typedArray)` | 填满随机字节并返回                                                   | CryptoKit / `SecRandomCopyBytes`                                                                                        |
| `randomUUID()`                | 返回 v4 UUID 字符串                                                  | `UUID().uuidString`                                                                                                     |
| `subtle.generateKey`          | `{name:'AES-GCM', length:256}` → CryptoKey                           | `AES.GCM` + `SymmetricKey(size: .bits256)`                                                                              |
| `subtle.importKey`            | `('raw', Uint8Array, 'AES-GCM', true, ['encrypt','decrypt'])`        | `SymmetricKey(data:)`                                                                                                   |
| `subtle.exportKey`            | `('raw', CryptoKey)` → ArrayBuffer                                   | `key.withUnsafeBytes`                                                                                                   |
| `subtle.encrypt / decrypt`    | `({name:'AES-GCM', iv, additionalData}, key, data)`                  | `AES.GCM.seal / open`（tag 在输出尾部 16B，与 WebCrypto 一致）                                                          |
| `subtle.deriveKey`            | PBKDF2-HMAC-SHA-256，210000 次（keyManager），100000 次（crdt 默认） | `CryptoKit` 无 PBKDF2 → 用 CommonCrypto `CCKeyDerivationPBKDF`（`kCCPBKDF2` + `kCCPRFHmacAlgSHA256`），或 `CryptoSwift` |

> CryptoKey 形态：Swift 桥创建 JS 侧 opaque 对象（持有 `SymmetricKey`），`encrypt/decrypt` 时回调 Swift。密钥本身**永不离开** JS 上下文之外的日志/存储——持久化由 `KVStore` 存 base64url 串（`exportKey`），与扩展行为一致。

缺失时不加载：bundle 顶层校验 `crypto.getRandomValues / randomUUID / subtle`，任一缺失即抛 `[bookmark-sync-core] globalThis.crypto 缺失…`。

### 2.2 `KVStore`（必注入；同步引擎的本地持久化抽象）

```ts
interface KVStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
```

Swift 实现建议：`UserDefaults`（小键：密钥/盐/绑定/counter）或 App Support 下的 JSON 文件（大键）。键命名（`src/sync/keyManager.ts`）：`crdt.e2eeKey`、`crdt.e2eeSalt`。其余键（绑定、afterId、counter）由 M5 的 Swift 侧持久层自定，走同一个 KVStore 即可。

### 2.3 `SupabaseRpcClient`（必注入；绕开 JSCore 缺失的 fetch）

```ts
interface SupabaseRpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
```

Swift 实现：`URLSession` POST `https://<project-ref>.supabase.co/rest/v1/rpc/<fn>`，Header `Authorization: Bearer <anon key 或用户 token>`、`Content-Type: application/json`，body = `JSONSerialization`（`args`）。返回 `{ data, error }`（REST 错误时 `error` 为 `{ code, message }` 对象；成功时 `data` 为 RPC 返回体）。

四个 RPC（与 `src/sync/oplogClient.ts` `SupabaseOpLogTransport` 一一对应）：

| fn                    | args                                             | 返回                                                                                            |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `bsync_op_push`       | `{ p_space, p_device, p_ops: [{seq, op, cid}] }` | `{ inserted, gc_needed }`                                                                       |
| `bsync_op_pull`       | `{ p_space, p_after_id, p_limit }`               | `{ rows: [{id, space_id, device_id, seq, op, cid, created_at}], last_id, has_more, gc_needed }` |
| `bsync_snapshot_pull` | `{ p_space }`                                    | `{ id, after_op_id, data, created_at } \| null`                                                 |
| `bsync_op_maybe_gc`   | `{ p_space, p_projection }`                      | `{ gced, deleted, snapshot_id }`                                                                |

> `op` 即加密信封 `{ iv, ciphertext }`（base64url，操作级 E2EE，AAD = UTF-8(space_id)）。Supabase 只见不透明 blob。

### 2.4 `btoa / atob`（bundle 自 polyfill，宿主无需处理）

`src/crdt/crypto/key.ts` 的 base64url 编解码硬依赖 `btoa/atob`，JSCore 不提供。bundle 入口在缺失时以纯 JS polyfill（与浏览器语义一致），已由冒烟脚本验证往返正确。**宿主不要自行注入**，避免双实现漂移。

### 2.5 `TextEncoder / TextDecoder`（宿主必须注入，M4a 真机新增）

JavaScriptCore **不提供** `TextEncoder / TextDecoder`（bundle 的 `aesGcm.ts` / `key.ts` / `opCrypto.ts` 大量使用：`new TextEncoder().encode(canonical)`、`new TextDecoder().decode(plain)`）。L1 的 node:vm 冒烟因 node 自带而**掩盖了该依赖**，直到 Swift 注入测试才暴露。

宿主注入：`new TextEncoder()` → `{ encode(str) -> Uint8Array }`，`new TextDecoder()` → `{ decode(bytes) -> string }`（Swift 实现见 `TextCodecBridge.swift`；encode 返回普通数组，JS 侧 `new Uint8Array(...)` 或按索引访问均成立）。

## 3. 导出清单（`globalThis.BookmarkSyncCore`）

- 协调器：`SyncCoordinator`（构造见下）、类型 `SyncCoordinatorOptions` / `PullOutcome`
- 传输：`SupabaseOpLogTransport`、`MemoryOpLogTransport`（测试）、`seqOf`、类型 `OpLogTransport` / `PushOp` / `OpRow` / `PullResult` / `PushResult` / `GcResult` / `SnapshotRow` / `SupabaseRpcClient`
- 密钥：`KeyManager`、类型 `KVStore`
- 加密：`encryptMoveOp` / `decryptMoveOp` / `encryptJson` / `decryptJson`、类型 `EncryptedOpEnvelope`
- CRDT：`Replica`、`apply_op` / `do_op` / `redo_op` / `undo_op` / `emptyState` / `logMoveToOp`、`ROOT_NODE_ID` / `TRASH_NODE_ID`、`cmpTimestamp` / `makeTimestamp`、`ancestor` / `get_parent`、`positionBetween` / `evenPositions` / `compactPositions`、类型 `MoveOp` / `Metadata` / `CrdtState` / `Edge` / `LogMove` / `Timestamp` / `SnapshotData`
- E2EE 原语：`generateKey` / `exportKey` / `importKey` / `deriveFromPassphrase` / `generateSalt` / `bytesToBase64url` / `base64urlToBytes` / `DecryptionError`
- 工厂：`createCore({ kv, rpc })` → `{ keyManager, transport }`

## 4. Swift 侧组装（M4 对接）

> **JSC 微任务限制（M4a 实测）**：JSCore 中 Promise 的 then 回调若用 Swift block
> （JSExport 桥接）实现，在微任务执行时**不会触发**（JSC 限制，已实验证实）。
> 所有需要等 JS Promise 结果的场景（如 `setKeyFromPassphrase`），必须用 **JS 闭包
> 把结果写入全局对象 + Swift 轮询**（参考 `CoreBridgeTests.awaitJS`）。bundle 内部
> async 函数体**同步调用** Swift block 注入的 crypto/kv 是正常的（不经过微任务回调）。

```swift
// 1) 注入四件套（2.1–2.5），再 evaluateScript 加载 bookmark-sync-core.js
let core = context.evaluateScript("BookmarkSyncCore") // JSValue → 桥

// 2) createCore({ kv, rpc })：单对象参数（Swift 侧构造 host 对象）
let host = JSValue(newObjectIn: context)!
host.setObject(kvBridge, forKeyedSubscript: "kv")   // 2.2
host.setObject(rpcBridge, forKeyedSubscript: "rpc") // 2.3
let inst = core.invokeMethod("createCore", withArguments: [host])

// 3) 口令派生（与扩展完全一致：同口令 + 同盐 → 同密钥）
let ok = inst.objectForKeyedSubscript("keyManager").invokeMethod("setKeyFromPassphrase", withArguments: [passphrase])
//    首次无盐时自动生成；多设备场景先 getSalt/setSalt 流转云端盐（扩展现有语义）

// 4) 组装协调器
let key = inst.objectForKeyedSubscript("keyManager").invokeMethod("ensureKey", withArguments: [])
let coordinator = core.invokeMethod("SyncCoordinator", withArguments: [
  ["spaceId": spaceId, "deviceId": deviceId,   // deviceId = CRDT replicaId = 一台设备
   "transport": inst.objectForKeyedSubscript("transport"),
   "key": key]
])

// 5) 之后就是引擎语义：createNode/moveNode/deleteNode → flushPush；pull → receiveOp
//    与扩展（src/background.ts 接线 chromeBridge）完全同一套调用面
```

## 5. 验证与回归

- 引擎回归：`pnpm test`（213 tests / 22 文件，含 CRDT 收敛、oplog、keyManager、快照 GC、E2E 桥）；bundle 是同一批源码的再出口，**不改一行引擎逻辑**。
- bundle 冒烟：`pnpm verify:core`（空沙箱拒绝加载 → 注入 crypto → 双设备收敛 → 删除墓碑 → E2EE 信封）。
- 环境要求：JavaScriptCore 需 macOS 11.3+（提供 `TextEncoder/TextDecoder`）；Swift 侧 `URLSession` 无额外要求。

## 6. 边界（不在本 bundle 内）

- **Safari 书签树 ↔ MoveOps 适配**（plist 宽容解析、FDA、FSEvents、安全写入）属 M3/M5/M6 的 Swift 侧工作，bundle 只提供 `MoveOp`/`Metadata` 形状与 `Replica` 应用语义供其调用。
- **登录/会话**（邮箱 OTP、Keychain 存 token）属 M2，Swift 侧直接用 Supabase Auth REST，不进 bundle。
- **设备限额计费**：macOS App 作为一个 device（replicaId），受迁移 0033 `device_limit` 约束；计费文案随 M5 一并确认。
