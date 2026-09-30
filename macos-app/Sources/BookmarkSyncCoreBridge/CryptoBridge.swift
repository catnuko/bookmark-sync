// CryptoBridge.swift — WebCrypto → CryptoKit/CommonCrypto 桥（M4a 注入面①）。
//
// 契约见 docs/safari-core-bundle.md §2.1：JSCore 无 WebCrypto，bundle 的
// opCrypto / crdt-crypto 全部走 globalThis.crypto。本桥以 JS 对象形式注入：
//
//   crypto = {
//     getRandomValues(u8) -> 填充后返回（普通数组形态，JS 侧 new Uint8Array 可用）
//     randomUUID()        -> UUID 字符串（Replica 的 replicaId 依赖）
//     subtle = {
//       generateKey / importKey / exportKey / deriveKey / encrypt / decrypt
//     }
//   }
//
// 实现要点：
//   - CryptoKit 的 AES-GCM seal/open 与 CommonCrypto 的 PBKDF2 都是**同步** API，
//     Swift 闭包同步返回结果 JSValue；JS 侧 `await` 非 Promise 值直接取用，
//     语义与 WebCrypto 的 Promise 兼容，无需 Promise 桥接。
//   - CryptoKey 是 JS 侧 opaque 对象：带 __bsyncKeyId 属性，真实 SymmetricKey
//     存 Swift 侧字典，密钥字节永不暴露给 JS/日志。
//   - 解密失败（错 key/篡改/AAD 不符）→ Swift 抛 NSError → JS 调用点抛异常，
//     opCrypto.decryptJson 的 try/catch 捕获后抛 DecryptionError（与浏览器一致）。

import CommonCrypto
import CryptoKit
import Foundation
import JavaScriptCore

/// 将 WebCrypto 语义桥到 Swift 加密原语的注入对象。
/// 生命周期：须随 JSContext 存活（CoreBridge 用 associated object 持有）。
final class CryptoBridge {

    private var keys: [String: SymmetricKey] = [:]
    private let lock = NSLock()

    // MARK: - 注入入口

    func makeCryptoObject(in context: JSContext) -> JSValue {
        let crypto = JSValue(newObjectIn: context)!
        crypto.setObject(getRandomValuesBlock, forKeyedSubscript: "getRandomValues" as NSString)
        crypto.setObject(randomUUIDBlock, forKeyedSubscript: "randomUUID" as NSString)

        let subtle = JSValue(newObjectIn: context)!
        subtle.setObject(generateKeyBlock, forKeyedSubscript: "generateKey" as NSString)
        subtle.setObject(importKeyBlock, forKeyedSubscript: "importKey" as NSString)
        subtle.setObject(exportKeyBlock, forKeyedSubscript: "exportKey" as NSString)
        subtle.setObject(deriveKeyBlock, forKeyedSubscript: "deriveKey" as NSString)
        subtle.setObject(encryptBlock, forKeyedSubscript: "encrypt" as NSString)
        subtle.setObject(decryptBlock, forKeyedSubscript: "decrypt" as NSString)

        crypto.setObject(subtle, forKeyedSubscript: "subtle" as NSString)
        return crypto
    }

    // MARK: - 密钥句柄

    private func store(_ key: SymmetricKey) -> String {
        let keyId = UUID().uuidString
        lock.lock()
        keys[keyId] = key
        lock.unlock()
        return keyId
    }

    private func take(_ handle: JSValue) -> SymmetricKey? {
        guard let keyId = handle.objectForKeyedSubscript("__bsyncKeyId")?.toString(),
              !keyId.isEmpty
        else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return keys[keyId]
    }

    private func makeKeyHandle(context: JSContext, id: String) -> JSValue {
        let handle = JSValue(newObjectIn: context)!
        handle.setObject(id, forKeyedSubscript: "__bsyncKeyId" as NSString)
        return handle
    }

    // MARK: - JS → Swift 值转换

    /// Uint8Array / 数组 → Data（nil = 参数非法，桥接层直接抛错）。
    private func data(from value: JSValue) -> Data? {
        guard !value.isUndefined, !value.isNull else { return nil }
        let array = value.toArray() as? [NSNumber] ?? []
        var bytes = [UInt8]()
        bytes.reserveCapacity(array.count)
        for n in array {
            bytes.append(UInt8(truncatingIfNeeded: n.uint32Value))
        }
        return Data(bytes)
    }

    private func jsData(_ data: Data, in context: JSContext) -> JSValue {
        JSValue(object: Array(data), in: context)
    }

    private func bridgeError(_ message: String) -> NSError {
        NSError(
            domain: "BookmarkSync.CryptoBridge",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    // MARK: - subtle 实现（同步，await 兼容）

    private lazy var generateKeyBlock: @convention(block) (JSValue) -> JSValue = { [weak self] _ in
        guard let self, let context = JSContext.current() else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        let key = SymmetricKey(size: .bits256)
        return makeKeyHandle(context: context, id: store(key))
    }

    private lazy var importKeyBlock: @convention(block) (JSValue, JSValue, JSValue, JSValue, JSValue) -> JSValue =
    { [weak self] _, raw, _, _, _ in
        guard let self, let context = JSContext.current(),
              let data = data(from: raw)
        else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        return makeKeyHandle(context: context, id: store(SymmetricKey(data: data)))
    }

    private lazy var exportKeyBlock: @convention(block) (JSValue, JSValue) -> JSValue =
    { [weak self] _, handle in
        guard let self, let context = JSContext.current(), let key = take(handle) else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        return jsData(key.withUnsafeBytes { Data($0) }, in: context)
    }

    private lazy var deriveKeyBlock: @convention(block) (JSValue, JSValue, JSValue, JSValue, JSValue) -> JSValue =
    { [weak self] params, baseKey, _, _, _ in
        guard let self, let context = JSContext.current(), let key = take(baseKey) else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        // params: { name: 'PBKDF2', salt: Uint8Array, iterations, hash: 'SHA-256' }
        guard let saltValue = params.objectForKeyedSubscript("salt"),
              let salt = data(from: saltValue),
              let iterations = params.objectForKeyedSubscript("iterations")?.toNumber()?.intValue
        else {
            context.exception = context.evaluateScript("new Error('PBKDF2 params 非法')")
            return JSValue(undefinedIn: context)
        }

        // baseKey（PBKDF2 输入密钥）= 'raw' 口令字节：导出 raw 再跑 CommonCrypto。
        guard let password = try? key.withUnsafeBytes({ Data($0) }) else {
            context.exception = context.evaluateScript("new Error('口令密钥导出失败')")
            return JSValue(undefinedIn: context)
        }

        var derived = [UInt8](repeating: 0, count: 32)
        let status = password.withUnsafeBytes { pw in
            salt.withUnsafeBytes { sl in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    pw.baseAddress?.assumingMemoryBound(to: CChar.self),
                    password.count,
                    sl.baseAddress?.assumingMemoryBound(to: UInt8.self),
                    salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    UInt32(iterations),
                    &derived,
                    derived.count
                )
            }
        }
        guard status == kCCSuccess else {
            context.exception = context.evaluateScript("new Error('PBKDF2 派生失败 status=\(status)')")
            return JSValue(undefinedIn: context)
        }
        return makeKeyHandle(context: context, id: store(SymmetricKey(data: Data(derived))))
    }

    private lazy var encryptBlock: @convention(block) (JSValue, JSValue, JSValue) -> JSValue =
    { [weak self] algorithm, handle, plaintext in
        guard let self, let context = JSContext.current(), let key = take(handle),
              let plain = self.data(from: plaintext)
        else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        do {
            let iv = algorithm.objectForKeyedSubscript("iv").flatMap { self.data(from: $0) } ?? Data()
            let aad = algorithm.objectForKeyedSubscript("additionalData").flatMap { self.data(from: $0) } ?? Data()
            guard iv.count == 12 else { throw bridgeError("IV 必须为 12 字节（AES-GCM 96-bit nonce）") }
            let nonce = try AES.GCM.Nonce(data: iv)
            let sealed = try AES.GCM.seal(plain, using: key, nonce: nonce, authenticating: aad)
            // WebCrypto 输出格式 = ciphertext || tag(16B)（不含 nonce）。
            // 注意：CryptoKit 的 sealed.combined 带 12B nonce 前缀，直接使用会造成
            // 与浏览器/扩展 envelope 不兼容 —— 必须按 WebCrypto 格式重新拼装。
            var combined = Data(sealed.ciphertext)
            combined.append(sealed.tag)
            return self.jsData(combined, in: context)
        } catch {
            context.exception = context.evaluateScript("new Error('AES-GCM seal 失败: \(error)')")
            return JSValue(undefinedIn: context)
        }
    }

    private lazy var decryptBlock: @convention(block) (JSValue, JSValue, JSValue) -> JSValue =
    { [weak self] algorithm, handle, ciphertext in
        guard let self, let context = JSContext.current(), let key = take(handle),
              let cipher = self.data(from: ciphertext)
        else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        do {
            let iv = algorithm.objectForKeyedSubscript("iv").flatMap { self.data(from: $0) } ?? Data()
            let aad = algorithm.objectForKeyedSubscript("additionalData").flatMap { self.data(from: $0) } ?? Data()
            guard iv.count == 12 else { throw bridgeError("IV 必须为 12 字节（AES-GCM 96-bit nonce）") }
            // WebCrypto 密文 = ciphertext || tag(16B)：切分后用显式 nonce 构造 SealedBox，
            // nonce 参与 GCM 认证（错误 IV 与浏览器行为一致地失败）。
            guard cipher.count > 16 else {
                throw bridgeError("密文过短（缺 tag）")
            }
            let ciphertext = cipher.prefix(cipher.count - 16)
            let tag = cipher.suffix(16)
            let nonce = try AES.GCM.Nonce(data: iv)
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let plain = try AES.GCM.open(box, using: key, authenticating: aad)
            return self.jsData(plain, in: context)
        } catch {
            // 认证失败（错 key / 篡改 / AAD 不符）→ 抛 JS 异常，opCrypto 捕获转 DecryptionError。
            context.exception = context.evaluateScript("new Error('AES-GCM 认证失败: \(error)')")
            return JSValue(undefinedIn: context)
        }
    }

    // MARK: - 顶层 crypto 实现

    private lazy var getRandomValuesBlock: @convention(block) (JSValue) -> JSValue =
    { [weak self] array in
        guard let self, let context = JSContext.current() else {
            return JSValue(undefinedIn: JSContext.current() ?? JSContext())
        }
        // Uint8Array / 普通数组都按元素数填充（typed array 的 toArray 为元素序列）。
        let count = array.toArray().count
        var bytes = [UInt8](repeating: 0, count: count)
        if !bytes.isEmpty {
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        }
        return JSValue(object: bytes, in: context)
    }

    private lazy var randomUUIDBlock: @convention(block) () -> String = {
        UUID().uuidString
    }
}
