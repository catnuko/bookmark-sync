// CoreBridgeTests.swift — JSCore 桥的全链路验证（M4a）。
//
// 与 scripts/verify-core-bundle.mjs 对齐，但**加密全部走 Swift 注入的桥**
// （CryptoKit AES-GCM + CommonCrypto PBKDF2），证明：
//   bundle 在真实 JavaScriptCore 里被 Swift 驱动 → 注入面契约成立 → 协议零漂移。
//
// 前置：仓库根目录先 `pnpm build:core`（本测试找不到 bundle 时 XCTSkip）。

import JavaScriptCore
import XCTest
@testable import BookmarkSyncCoreBridge

final class CoreBridgeTests: XCTestCase {

    private let spaceId = "space-00000000-0000-4000-8000-000000000001"
    private let deviceA = "dev-00000000-0000-4000-8000-00000000000a"

    // MARK: - 工具

    /// JSValue 可选解包（nil 视为测试失败）。
    private func unwrap(
        _ value: JSValue?,
        _ label: String = "",
        file: StaticString = #filePath,
        line: UInt = #line
    ) -> JSValue {
        guard let value else {
            XCTFail("JSValue 为 nil：\(label)", file: file, line: line)
            return JSValue(undefinedIn: JSContext())
        }
        return value
    }

    /// 等待 JS Promise 完成（Swift 侧等 JS 异步结果）。
    ///
    /// 注意：JSCore 中 Promise 的 then 回调若用 Swift block（JSExport 桥接）实现，
    /// 在微任务执行时不会触发（JSC 限制，已实验证实）；必须用 JS 闭包把结果写入
    /// 全局对象，Swift 侧轮询读取。JS 闭包在微任务里正常执行。
    private func awaitJS(
        _ promise: JSValue?,
        in context: JSContext,
        timeout: TimeInterval = 15
    ) throws -> JSValue {
        guard let promise else {
            throw NSError(domain: "CoreBridgeTests", code: 0, userInfo: [NSLocalizedDescriptionKey: "JSValue 为 nil"])
        }
        let wrap = context.evaluateScript(
            "(function(p){ globalThis.__await = { done: false, value: undefined, error: undefined }; " +
            "p.then(function(v){ globalThis.__await = { done: true, value: v, error: undefined }; }, " +
            "function(e){ globalThis.__await = { done: true, value: undefined, error: String((e && e.message) || e) }; }); })"
        )
        _ = wrap?.call(withArguments: [promise])

        let start = Date()
        while true {
            context.evaluateScript("void 0") // 驱动 JSCore 微任务队列
            let state = context.objectForKeyedSubscript("__await")
            if state?.objectForKeyedSubscript("done")?.toBool() == true {
                if let error = state?.objectForKeyedSubscript("error")?.toString(),
                   !error.isEmpty, error != "undefined"
                {
                    throw NSError(
                        domain: "CoreBridgeTests",
                        code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "JS Promise reject: \(error)"]
                    )
                }
                return state?.objectForKeyedSubscript("value") ?? JSValue(undefinedIn: context)
            }
            if Date().timeIntervalSince(start) > timeout {
                throw NSError(domain: "CoreBridgeTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "JS Promise 超时"])
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
    }

    /// 独立 UserDefaults suite 清理（避免污染生产 defaults）。
    private func freshSuite(_ name: String) -> UserDefaults {
        let suite = UserDefaults(suiteName: name)!
        suite.removePersistentDomain(forName: name)
        return suite
    }

    // MARK: - 用例

    func testBundleLoadsWithSwiftCrypto() throws {
        try XCTSkipUnless(
            FileManager.default.fileExists(atPath: CoreBridge.defaultBundlePath),
            "先运行 `pnpm build:core` 生成 dist/core/bookmark-sync-core.js"
        )
        let context = try CoreBridge.loadBundle(defaults: freshSuite("bsync.test.load"))
        // bundle 顶层校验要求 crypto.getRandomValues/randomUUID/subtle —— 加载成功
        // 即证明 Swift 注入面①生效。
        let core = unwrap(context.objectForKeyedSubscript("BookmarkSyncCore"), "BookmarkSyncCore")
        XCTAssertFalse(core.isUndefined, "BookmarkSyncCore 应被导出")
        XCTAssertEqual(
            unwrap(core.objectForKeyedSubscript("ROOT_NODE_ID"), "ROOT_NODE_ID").toString(),
            "__root__"
        )
    }

    func testKeyManagerDerivesKeyViaSwiftPBKDF2() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: CoreBridge.defaultBundlePath), "先运行 pnpm build:core")
        let context = try CoreBridge.loadBundle(defaults: freshSuite("bsync.test.km"))
        let inst = CoreBridge.createCore(in: context)
        let keyManager = unwrap(inst.objectForKeyedSubscript("keyManager"), "keyManager")

        let ok = try awaitJS(
            keyManager.invokeMethod("setKeyFromPassphrase", withArguments: ["test-passphrase-12345"]),
            in: context
        )
        XCTAssertEqual(ok.toBool(), true, "口令派生应成功（Swift PBKDF2 210k 次）")

        let key = try awaitJS(keyManager.invokeMethod("ensureKey", withArguments: []), in: context)
        XCTAssertFalse(key.isUndefined, "应持有 CryptoKey 句柄")

        let salt = try awaitJS(keyManager.invokeMethod("getSalt", withArguments: []), in: context)
        XCTAssertFalse(salt.toString().isEmpty, "盐应已生成")
    }

    func testFullSyncLoopViaSwiftCrypto() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: CoreBridge.defaultBundlePath), "先运行 pnpm build:core")
        let context = try CoreBridge.loadBundle(defaults: freshSuite("bsync.test.sync"))
        let core = unwrap(context.objectForKeyedSubscript("BookmarkSyncCore"), "BookmarkSyncCore")
        let inst = CoreBridge.createCore(in: context)
        let keyManager = unwrap(inst.objectForKeyedSubscript("keyManager"), "keyManager")

        _ = try awaitJS(keyManager.invokeMethod("setKeyFromPassphrase", withArguments: ["test-passphrase-12345"]), in: context)
        let key = try awaitJS(keyManager.invokeMethod("ensureKey", withArguments: []), in: context)

        let rootId = unwrap(core.objectForKeyedSubscript("ROOT_NODE_ID"), "ROOT_NODE_ID").toString()!
        let transport = unwrap(
            core.objectForKeyedSubscript("MemoryOpLogTransport"), "MemoryOpLogTransport"
        ).construct(withArguments: [])!
        let coordinator = unwrap(
            core.objectForKeyedSubscript("SyncCoordinator"), "SyncCoordinator"
        ).construct(withArguments: [[
            "spaceId": spaceId,
            "deviceId": deviceA,
            "transport": transport,
            "key": key,
        ]])!

        // 根结构（ensureRoots 在构造时执行）
        let roots = unwrap(
            unwrap(coordinator.objectForKeyedSubscript("replica"), "replica").invokeMethod(
                "getChildren", withArguments: [rootId]
            ), "getChildren(root)"
        ).toArray()!
        let parent = (roots.first as? [String: Any])?["id"] as? String ?? rootId
        XCTAssertNotEqual(parent, rootId, "应有根文件夹")

        // 创建节点 → flushPush（Swift AES-GCM 加密）
        let nodeId = coordinator.invokeMethod("createNode", withArguments: [
            parent,
            ["title": "Hello Safari", "url": "https://example.com"],
        ])!.toString()!
        XCTAssertFalse(nodeId.isEmpty)

        let pushed = try awaitJS(coordinator.invokeMethod("flushPush", withArguments: []), in: context)
        XCTAssertEqual(pushed.toInt32(), 1, "应推送 1 条加密 op")

        // pull 自回读（Swift AES-GCM 解密 + receiveOp）
        let outcome = try awaitJS(coordinator.invokeMethod("pull", withArguments: []), in: context)
        XCTAssertEqual(unwrap(outcome.objectForKeyedSubscript("applied"), "applied").toInt32(), 1)

        // 收敛断言
        let afterChildren = unwrap(
            unwrap(coordinator.objectForKeyedSubscript("replica"), "replica").invokeMethod(
                "getChildren", withArguments: [parent]
            ), "getChildren(after)"
        ).toArray()!
        let found = afterChildren.contains { item in
            (item as? [String: Any])?["id"] as? String == nodeId
        }
        XCTAssertTrue(found, "pull 后 replica 应包含新建节点")

        // 删除墓碑 + 收敛
        coordinator.invokeMethod("deleteNode", withArguments: [nodeId])
        _ = try awaitJS(coordinator.invokeMethod("flushPush", withArguments: []), in: context)
        _ = try awaitJS(coordinator.invokeMethod("pull", withArguments: []), in: context)
        let finalChildren = unwrap(
            unwrap(coordinator.objectForKeyedSubscript("replica"), "replica").invokeMethod(
                "getChildren", withArguments: [parent]
            ), "getChildren(final)"
        ).toArray()!
        XCTAssertFalse(
            finalChildren.contains { ($0 as? [String: Any])?["id"] as? String == nodeId },
            "删除墓碑应收敛"
        )
    }

    func testWrongKeyDecryptionRejects() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: CoreBridge.defaultBundlePath), "先运行 pnpm build:core")
        let context = try CoreBridge.loadBundle(defaults: freshSuite("bsync.test.wrongkey"))
        let core = unwrap(context.objectForKeyedSubscript("BookmarkSyncCore"), "BookmarkSyncCore")
        let inst = CoreBridge.createCore(in: context)
        let keyManager = unwrap(inst.objectForKeyedSubscript("keyManager"), "keyManager")

        // 设备 A：口令 p1；随后同盐换口令 p2 派生 keyB（独立派生走 Swift 桥）。
        _ = try awaitJS(keyManager.invokeMethod("setKeyFromPassphrase", withArguments: ["passphrase-A-12345"]), in: context)
        let keyA = try awaitJS(keyManager.invokeMethod("ensureKey", withArguments: []), in: context)
        let saltA = try awaitJS(keyManager.invokeMethod("getSalt", withArguments: []), in: context)

        _ = try awaitJS(keyManager.invokeMethod("setSalt", withArguments: [saltA.toString()!]), in: context)
        _ = try awaitJS(keyManager.invokeMethod("setKeyFromPassphrase", withArguments: ["passphrase-B-12345"]), in: context)
        let keyB = try awaitJS(keyManager.invokeMethod("ensureKey", withArguments: []), in: context)

        // A 加密 → B 解密：密钥不匹配 → Promise reject（Swift AES-GCM 认证失败 → JS 异常）。
        let envelope = try awaitJS(core.invokeMethod("encryptMoveOp", withArguments: [
            ["t": ["counter": 1, "replicaId": deviceA], "p": "__root__", "m": ["title": "x"], "c": "node-1"],
            keyA,
            spaceId,
        ]), in: context)

        XCTAssertThrowsError(
            try awaitJS(core.invokeMethod("decryptMoveOp", withArguments: [envelope, keyB, spaceId]), in: context),
            "错误密钥解密应 reject"
        )
    }
}
