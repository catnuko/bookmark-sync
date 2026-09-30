// TextCodecBridge.swift — TextEncoder / TextDecoder 注入（M4a 注入面④）。
//
// 契约修订：docs/safari-core-bundle.md 原只列 crypto / KVStore / rpc / btoa-atob
// polyfill。真机发现 JavaScriptCore **没有 TextEncoder / TextDecoder**（bundle 的
// aesGcm.ts / key.ts / opCrypto.ts 大量使用，node:vm 冒烟因 node 自带而掩盖了该
// 依赖）——宿主必须注入。返回值为普通 JS 数组（含 length/索引），JS 侧
// `new Uint8Array(...)` 包装或直接按索引访问均成立。

import Foundation
import JavaScriptCore

enum TextCodecBridge {

    /// 注入 TextEncoder 构造器（new TextEncoder() → { encode(str) -> bytes }）。
    static func makeTextEncoder(in context: JSContext) -> JSValue {
        let ctor: @convention(block) () -> JSValue = {
            let ctx = JSContext.current() ?? context
            let obj = JSValue(newObjectIn: ctx)!
            let encode: @convention(block) (String) -> JSValue = { str in
                let bytes = Array(str.utf8)
                return JSValue(object: bytes, in: JSContext.current() ?? ctx)
            }
            obj.setObject(encode, forKeyedSubscript: "encode" as NSString)
            return obj
        }
        return JSValue(object: ctor, in: context) ?? JSValue(undefinedIn: context)
    }

    /// 注入 TextDecoder 构造器（new TextDecoder() → { decode(bytes) -> string }）。
    static func makeTextDecoder(in context: JSContext) -> JSValue {
        let ctor: @convention(block) () -> JSValue = {
            let ctx = JSContext.current() ?? context
            let obj = JSValue(newObjectIn: ctx)!
            let decode: @convention(block) (JSValue) -> JSValue = { bytesValue in
                let items = bytesValue.toArray() as? [NSNumber] ?? []
                var bytes = [UInt8]()
                bytes.reserveCapacity(items.count)
                for n in items {
                    bytes.append(UInt8(truncatingIfNeeded: n.uint32Value))
                }
                let text = String(decoding: bytes, as: UTF8.self)
                return JSValue(object: text, in: JSContext.current() ?? ctx)
            }
            obj.setObject(decode, forKeyedSubscript: "decode" as NSString)
            return obj
        }
        return JSValue(object: ctor, in: context) ?? JSValue(undefinedIn: context)
    }
}
