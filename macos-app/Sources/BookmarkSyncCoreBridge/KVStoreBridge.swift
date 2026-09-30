// KVStoreBridge.swift — KVStore / SupabaseRpcClient 注入（M4a 注入面②③）。
//
// 契约见 docs/safari-core-bundle.md §2.2 / §2.3：
//   KVStore：get/set/remove（生产 = UserDefaults.standard，测试可注入独立 suite）；
//   SupabaseRpcClient：rpc(fn, args) → {data,error}（M4b 用 URLSession 接真实会话，
//     M4a 先注入占位——任何调用抛错，保证「未配置时快速失败」而不是静默吞掉）。
//
// 注入对象挂到 JS 全局（globalThis.kv / globalThis.rpc），
// createCore({ kv, rpc }) 由 CoreBridge 组装时传入。

import Foundation
import JavaScriptCore

enum KVStoreBridge {

    /// 注入 KVStore 对象。`defaults` 缺省 = UserDefaults.standard（测试传独立 suite）。
    static func makeKVObject(in context: JSContext, defaults: UserDefaults = .standard) -> JSValue {
        let kv = JSValue(newObjectIn: context)!

        let get: @convention(block) (String) -> JSValue = { key in
            let ctx = JSContext.current() ?? context
            if let value = defaults.string(forKey: "bsync.\(key)") {
                return JSValue(object: value, in: ctx)
            }
            return JSValue(undefinedIn: ctx)
        }
        let set: @convention(block) (String, String) -> Void = { key, value in
            defaults.set(value, forKey: "bsync.\(key)")
        }
        let remove: @convention(block) (String) -> Void = { key in
            defaults.removeObject(forKey: "bsync.\(key)")
        }

        kv.setObject(get, forKeyedSubscript: "get" as NSString)
        kv.setObject(set, forKeyedSubscript: "set" as NSString)
        kv.setObject(remove, forKeyedSubscript: "remove" as NSString)
        return kv
    }

    /// 注入 rpc 占位：任何调用抛错（M4b 换成 URLSession + 会话 token）。
    static func makeRpcPlaceholder(in context: JSContext) -> JSValue {
        let rpc = JSValue(newObjectIn: context)!
        let invoke: @convention(block) (String, JSValue) -> JSValue = { fn, _ in
            let ctx = JSContext.current() ?? context
            ctx.exception = ctx.evaluateScript(
                "new Error('Supabase RPC 未配置（M4b: URLSession + 会话接入）: \(fn)')"
            )
            return JSValue(undefinedIn: ctx)
        }
        rpc.setObject(invoke, forKeyedSubscript: "rpc" as NSString)
        return rpc
    }
}
