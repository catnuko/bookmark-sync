// SupabaseRpcClientTests.swift — rpc 客户端的请求构造 / 响应映射验证（M4b）。
//
// 用 URLProtocol mock 拦截 https://*.supabase.co，**无需真实 Supabase 密钥**即可
// 验证：URL 路径、header（apikey/Authorization/Content-Type）、body JSON 形状、
// 成功 data 解析、HTTP 错误映射、网络错误映射、JS Promise 结算（res/rej 主线程调用）。

import JavaScriptCore
import XCTest
@testable import BookmarkSyncCoreBridge

/// URLProtocol mock：拦截 https://*.supabase.co，按 handler 返回预设响应。
final class MockSupabaseProtocol: URLProtocol {

    nonisolated(unsafe) static var handler: ((URLRequest) -> (status: Int, body: Data?, error: Error?))?

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host?.hasSuffix("supabase.co") == true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let result = handler(request)
        if let error = result.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: result.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if let body = result.body {
            client?.urlProtocol(self, didLoad: body)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class SupabaseRpcClientTests: XCTestCase {

    private let config = SupabaseRpcClient.Config(
        projectURL: "https://abcdefghijklm.supabase.co",
        anonKey: "anon-test-key-1234567890"
    )

    /// mock session（URLProtocol 拦截）+ 注入 rpc 的 JSContext。
    private func makeContext() throws -> (JSContext, JSValue, URLSession) {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockSupabaseProtocol.self]
        let session = URLSession(configuration: sessionConfig)
        let context = try CoreBridge.loadBundle(
            defaults: UserDefaults(suiteName: "bsync.test.rpc")!,
            supabase: config,
            session: session
        )
        let rpc = context.objectForKeyedSubscript("rpc")!
        return (context, rpc, session)
    }

    /// URLSession 会把 POST body 移到 httpBodyStream（支持重发），读取需两者兼容。
    private func bodyData(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufSize = 4096
        let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
        defer { buf.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buf, maxLength: bufSize)
            if read <= 0 { break }
            data.append(buf, count: read)
        }
        return data
    }

    /// 等 JS Promise（JS 闭包写全局 + Swift 轮询，同 CoreBridgeTests.awaitJS）。
    private func awaitJS(_ promise: JSValue?, in context: JSContext, timeout: TimeInterval = 5) throws -> JSValue {
        guard let promise else {
            throw NSError(domain: "RpcTests", code: 0, userInfo: [NSLocalizedDescriptionKey: "JSValue nil"])
        }
        let wrap = context.evaluateScript(
            "(function(p){ globalThis.__await = { done: false, value: undefined, error: undefined }; " +
            "p.then(function(v){ globalThis.__await = { done: true, value: v, error: undefined }; }, " +
            "function(e){ globalThis.__await = { done: true, value: undefined, error: String((e && e.message) || e) }; }); })"
        )
        _ = wrap?.call(withArguments: [promise])
        // 轮询 + RunLoop：不能忙等占住主线程——URLSession 完成回调经
        // DispatchQueue.main.async 排队，主线程空闲时才会执行（否则死锁超时）。
        let start = Date()
        while true {
            context.evaluateScript("void 0")
            let state = context.objectForKeyedSubscript("__await")
            if state?.objectForKeyedSubscript("done")?.toBool() == true {
                if let error = state?.objectForKeyedSubscript("error")?.toString(),
                   !error.isEmpty, error != "undefined"
                {
                    throw NSError(domain: "RpcTests", code: 3, userInfo: [NSLocalizedDescriptionKey: "reject: \(error)"])
                }
                return state?.objectForKeyedSubscript("value") ?? JSValue(undefinedIn: context)
            }
            if Date().timeIntervalSince(start) > timeout {
                throw NSError(domain: "RpcTests", code: 2, userInfo: [NSLocalizedDescriptionKey: "超时"])
            }
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
    }

    // MARK: - 用例

    func testPullRequestShape() throws {
        var captured: URLRequest?
        MockSupabaseProtocol.handler = { request in
            captured = request
            let body: [String: Any] = ["rows": [], "last_id": 7, "has_more": false, "gc_needed": false]
            return (200, try? JSONSerialization.data(withJSONObject: body), nil)
        }
        let (context, rpc, _) = try makeContext()
        let result = try awaitJS(
            rpc.objectForKeyedSubscript("rpc")?.call(withArguments: [
                "bsync_op_pull",
                ["p_space": "space-1", "p_after_id": 3, "p_limit": 50],
            ]),
            in: context
        )

        let request = try XCTUnwrap(captured, "应捕获到请求")
        XCTAssertEqual(request.url?.absoluteString, "https://abcdefghijklm.supabase.co/rest/v1/rpc/bsync_op_pull")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "apikey"), "anon-test-key-1234567890")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer anon-test-key-1234567890")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(bodyData(of: request))
        let json = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        XCTAssertEqual(json?["p_space"] as? String, "space-1")
        XCTAssertEqual(json?["p_after_id"] as? Int, 3)
        XCTAssertEqual(json?["p_limit"] as? Int, 50)

        // data 映射
        let data = try XCTUnwrap(result.objectForKeyedSubscript("data")?.toObject() as? [String: Any])
        XCTAssertEqual(data["last_id"] as? Int, 7)
        XCTAssertTrue(
            result.objectForKeyedSubscript("error")?.isNull == true,
            "成功时 error 应为 null"
        )
    }

    func testPushBodyHasOpsArray() throws {
        var captured: URLRequest?
        MockSupabaseProtocol.handler = { request in
            captured = request
            return (200, try? JSONSerialization.data(withJSONObject: ["inserted": 1, "gc_needed": false]), nil)
        }
        let (context, rpc, _) = try makeContext()
        let result = try awaitJS(
            rpc.objectForKeyedSubscript("rpc")?.call(withArguments: [
                "bsync_op_push",
                ["p_space": "space-1", "p_device": "dev-1", "p_ops": [
                    ["seq": 1, "op": ["iv": "abc", "ciphertext": "xyz"], "cid": nil],
                ]],
            ]),
            in: context
        )
        let json = try JSONSerialization.jsonObject(with: XCTUnwrap(bodyData(of: XCTUnwrap(captured)))) as? [String: Any]
        let ops = json?["p_ops"] as? [[String: Any]]
        XCTAssertEqual(ops?.first?["seq"] as? Int, 1)
        XCTAssertEqual((ops?.first?["op"] as? [String: String])?["iv"], "abc")
        let data = try XCTUnwrap(result.objectForKeyedSubscript("data")?.toObject() as? [String: Any])
        XCTAssertEqual(data["inserted"] as? Int, 1)
    }

    func testHttpErrorMapsToErrorField() throws {
        MockSupabaseProtocol.handler = { _ in
            (401, Data(#"{"message":"JWT expired"}"#.utf8), nil)
        }
        let (context, rpc, _) = try makeContext()
        let result = try awaitJS(
            rpc.objectForKeyedSubscript("rpc")?.call(withArguments: ["bsync_op_pull", [:]]),
            in: context
        )
        // 契约：错误走 error 字段（rpc 永不 reject，transport 解构 {data,error} 后判 error）。
        let error = try XCTUnwrap(result.objectForKeyedSubscript("error")?.toObject() as? [String: Any])
        XCTAssertEqual(error["code"] as? Int, 401)
        XCTAssertEqual(error["message"] as? String, "JWT expired")
    }

    func testServerErrorMapsToErrorField() throws {
        MockSupabaseProtocol.handler = { _ in
            (500, Data("Internal Server Error".utf8), nil)
        }
        let (context, rpc, _) = try makeContext()
        let result = try awaitJS(
            rpc.objectForKeyedSubscript("rpc")?.call(withArguments: ["bsync_op_pull", [:]]),
            in: context
        )
        let error = try XCTUnwrap(result.objectForKeyedSubscript("error")?.toObject() as? [String: Any])
        XCTAssertEqual(error["code"] as? Int, 500)
    }

    func testNetworkErrorMapsToErrorField() throws {
        MockSupabaseProtocol.handler = { _ in
            (0, nil, URLError(.notConnectedToInternet))
        }
        let (context, rpc, _) = try makeContext()
        let result = try awaitJS(
            rpc.objectForKeyedSubscript("rpc")?.call(withArguments: ["bsync_op_pull", [:]]),
            in: context
        )
        let error = try XCTUnwrap(result.objectForKeyedSubscript("error")?.toObject() as? [String: Any])
        XCTAssertEqual(error["code"] as? String, "NETWORK")
    }

    func testNullDataResolvesNull() throws {
        MockSupabaseProtocol.handler = { _ in
            (200, Data("null".utf8), nil)
        }
        let (context, rpc, _) = try makeContext()
        let result = try awaitJS(
            rpc.objectForKeyedSubscript("rpc")?.call(withArguments: ["bsync_snapshot_pull", ["p_space": "s"]]),
            in: context
        )
        XCTAssertTrue(
            result.objectForKeyedSubscript("data")?.isNull == true,
            "bsync_snapshot_pull 空快照应返回 null data"
        )
    }

    func testUnconfiguredEnvironmentYieldsNil() {
        // 不设置环境变量时 fromEnvironment() 应为 nil（占位快速失败）。
        // 测试环境可能恰好有变量，这里显式验证缺失场景。
        let saved = (
            ProcessInfo.processInfo.environment["BOOKMARK_SYNC_SUPABASE_URL"],
            ProcessInfo.processInfo.environment["BOOKMARK_SYNC_SUPABASE_ANON_KEY"]
        )
        setenv("BOOKMARK_SYNC_SUPABASE_URL", "", 1)
        setenv("BOOKMARK_SYNC_SUPABASE_ANON_KEY", "", 1)
        XCTAssertNil(SupabaseRpcClient.fromEnvironment())
        if let url = saved.0 { setenv("BOOKMARK_SYNC_SUPABASE_URL", url, 1) } else { unsetenv("BOOKMARK_SYNC_SUPABASE_URL") }
        if let key = saved.1 { setenv("BOOKMARK_SYNC_SUPABASE_ANON_KEY", key, 1) } else { unsetenv("BOOKMARK_SYNC_SUPABASE_ANON_KEY") }
    }
}
