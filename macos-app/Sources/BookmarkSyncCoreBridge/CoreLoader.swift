// CoreLoader.swift — 加载 core bundle 并组装注入面（M4a 汇合点）。
//
// 流程（对齐 docs/safari-core-bundle.md §4 伪代码）：
//   1. 新建 JSContext，挂 exceptionHandler；
//   2. 注入 crypto（CryptoKit 桥）/ kv（UserDefaults）/ rpc（占位，M4b 换真实）；
//   3. evaluateScript 加载 dist/core/bookmark-sync-core.js → globalThis.BookmarkSyncCore；
//   4. createCore({ kv, rpc }) → { keyManager, transport }，供 Swift 组装 SyncCoordinator。
//
// CryptoBridge 实例必须随 context 存活（闭包 [weak self]）→ associated object 持有。

import Foundation
import JavaScriptCore
import ObjectiveC

public enum CoreBridge {

    private static var bridgeKey: UInt8 = 0
    private static var rpcKey: UInt8 = 0

    /// M4c：最近一次注入的真实 rpc client（App 主线程访问，登录后 setAuthToken）。
    /// 未配置 supabase 时保持 nil（占位 rpc 无 token 概念）。
    public private(set) static var lastRpcClient: SupabaseRpcClient?

    /// 默认 bundle 路径：swift run / swift test 的 cwd 是 macos-app/，
    /// 产物在 ../dist/core/bookmark-sync-core.js（先 `pnpm build:core`）。
    public static var defaultBundlePath: String {
        let cwd = FileManager.default.currentDirectoryPath
        return (cwd as NSString).appendingPathComponent("../dist/core/bookmark-sync-core.js")
    }

    /// 加载 bundle 到新 JSContext（注入注入面四件套 + rpc）。
    /// - Parameters:
    ///   - supabase: 非 nil 时注入真实 URLSession rpc 客户端；nil 时注入占位
    ///     （未配置快速失败，行为同 M4a）。
    /// - throws: bundle 文件缺失 / JS 加载失败 / BookmarkSyncCore 未导出。
    public static func loadBundle(
        at path: String = defaultBundlePath,
        defaults: UserDefaults = .standard,
        supabase: SupabaseRpcClient.Config? = nil,
        session: URLSession = .shared
    ) throws -> JSContext {
        guard FileManager.default.fileExists(atPath: path) else {
            throw CoreBridgeError.bundleMissing(path: path)
        }
        let source = try String(contentsOfFile: path, encoding: .utf8)

        let context = JSContext()!
        context.exceptionHandler = { _, exception in
            print("[bsync-mac] JS 异常: \(exception?.toString() ?? "unknown")")
        }

        // 注入面①：crypto（Swift CryptoKit/CommonCrypto 实现）。
        let cryptoBridge = CryptoBridge()
        objc_setAssociatedObject(
            context,
            &bridgeKey,
            cryptoBridge,
            .OBJC_ASSOCIATION_RETAIN
        )
        context.setObject(
            cryptoBridge.makeCryptoObject(in: context),
            forKeyedSubscript: "crypto" as NSString
        )

        // 注入面②：kv 挂全局，createCore 组装时取用。
        context.setObject(
            KVStoreBridge.makeKVObject(in: context, defaults: defaults),
            forKeyedSubscript: "kv" as NSString
        )

        // 注入面③：rpc —— 有配置走真实 URLSession 客户端，否则占位快速失败。
        if let supabase {
            let client = SupabaseRpcClient(config: supabase, session: session)
            objc_setAssociatedObject(context, &rpcKey, client, .OBJC_ASSOCIATION_RETAIN)
            lastRpcClient = client
            context.setObject(
                client.makeRpcObject(in: context),
                forKeyedSubscript: "rpc" as NSString
            )
        } else {
            lastRpcClient = nil
            context.setObject(
                KVStoreBridge.makeRpcPlaceholder(in: context),
                forKeyedSubscript: "rpc" as NSString
            )
        }

        // 注入面④：JSCore 无 TextEncoder/TextDecoder（bundle 依赖，node:vm 冒烟掩盖）。
        context.setObject(
            TextCodecBridge.makeTextEncoder(in: context),
            forKeyedSubscript: "TextEncoder" as NSString
        )
        context.setObject(
            TextCodecBridge.makeTextDecoder(in: context),
            forKeyedSubscript: "TextDecoder" as NSString
        )

        context.evaluateScript(source)

        guard let core = context.objectForKeyedSubscript("BookmarkSyncCore"),
              !core.isUndefined, !core.isNull
        else {
            throw CoreBridgeError.coreExportMissing
        }
        return context
    }

    /// 组装 createCore 实例（等价 JS: BookmarkSyncCore.createCore({ kv, rpc })）。
    public static func createCore(in context: JSContext) -> JSValue {
        guard let core = context.objectForKeyedSubscript("BookmarkSyncCore") else {
            return JSValue(undefinedIn: context)
        }
        let host = JSValue(newObjectIn: context)!
        host.setObject(context.globalObject.objectForKeyedSubscript("kv"), forKeyedSubscript: "kv" as NSString)
        host.setObject(context.globalObject.objectForKeyedSubscript("rpc"), forKeyedSubscript: "rpc" as NSString)
        return core.invokeMethod("createCore", withArguments: [host])
    }
}

public enum CoreBridgeError: LocalizedError {
    case bundleMissing(path: String)
    case coreExportMissing

    public var errorDescription: String? {
        switch self {
        case .bundleMissing(let path):
            return "core bundle 不存在：\(path)（先在本仓库根目录跑 `pnpm build:core`）"
        case .coreExportMissing:
            return "bundle 加载后未导出 BookmarkSyncCore"
        }
    }
}
