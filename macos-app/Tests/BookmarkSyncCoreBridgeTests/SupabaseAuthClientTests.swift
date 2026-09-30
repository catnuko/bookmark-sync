// SupabaseAuthClientTests.swift — email/password 登录（M4c）。
//
// 不依赖真实 Supabase：URLProtocol mock GoTrue /auth/v1/token 端点，
// 验证请求形状（URL/grant_type/header/body）、成功解析与错误映射。

import XCTest
import BookmarkSyncCoreBridge

/// mock URLProtocol：拦截 auth/v1/token（与 rpc mock 同模式）。
final class MockAuthProtocol: URLProtocol {

    nonisolated(unsafe) static var handler: ((URLRequest) -> (status: Int, body: Data?, error: Error?))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = MockAuthProtocol.handler else {
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
            httpVersion: nil,
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

/// 内存会话存储（测试用，避免碰真 Keychain）。
final class InMemorySessionStore: SessionStore {
    private var session: AuthSession?
    func save(_ s: AuthSession) throws { session = s }
    func load() -> AuthSession? { session }
    func clear() { session = nil }
}

final class SupabaseAuthClientTests: XCTestCase {

    private let config = SupabaseRpcClient.Config(
        projectURL: "https://abcdefghijklm.supabase.co",
        anonKey: "anon-test-key-1234567890"
    )

    private func makeClient(store: SessionStore = InMemorySessionStore()) throws -> SupabaseAuthClient {
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [MockAuthProtocol.self]
        let session = URLSession(configuration: sessionConfig)
        return SupabaseAuthClient(config: config, session: session, store: store)
    }

    private func wait(
        _ expectation: XCTestExpectation,
        timeout: TimeInterval = 5
    ) {
        let result = XCTWaiter.wait(for: [expectation], timeout: timeout)
        XCTAssertEqual(result, .completed, "等待超时")
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

    // MARK: - 用例

    func testLoginRequestShape() throws {
        var captured: URLRequest?
        MockAuthProtocol.handler = { request in
            captured = request
            return (200, Data(#"{"access_token":"at-1","refresh_token":"rt-1","user":{"id":"u-1","email":"a@b.c"}}"#.utf8), nil)
        }
        let client = try makeClient()
        let exp = expectation(description: "login")
        var result: Result<AuthSession, AuthError>?
        client.login(email: "a@b.c", password: "pw-1") { result = $0; exp.fulfill() }
        wait(exp)

        guard case .success(let session) = result else {
            XCTFail("应登录成功")
            return
        }
        let request = try XCTUnwrap(captured)
        XCTAssertEqual(
            request.url?.absoluteString,
            "https://abcdefghijklm.supabase.co/auth/v1/token?grant_type=password"
        )
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "apikey"), "anon-test-key-1234567890")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let json = try JSONSerialization.jsonObject(with: bodyData(of: request) ?? Data()) as? [String: Any]
        XCTAssertEqual(json?["email"] as? String, "a@b.c")
        XCTAssertEqual(json?["password"] as? String, "pw-1")

        XCTAssertEqual(session.accessToken, "at-1")
        XCTAssertEqual(session.refreshToken, "rt-1")
        XCTAssertEqual(session.userId, "u-1")
        XCTAssertEqual(session.email, "a@b.c")
    }

    func testLoginPersistsSession() throws {
        MockAuthProtocol.handler = { _ in
            (200, Data(#"{"access_token":"at-2","refresh_token":"rt-2","user":{"id":"u-2"}}"#.utf8), nil)
        }
        let store = InMemorySessionStore()
        let client = try makeClient(store: store)
        let exp = expectation(description: "login")
        client.login(email: "a@b.c", password: "pw") { _ in exp.fulfill() }
        wait(exp)

        XCTAssertEqual(store.load()?.accessToken, "at-2")
        // savedSession 走同一 store
        XCTAssertEqual(client.savedSession?.refreshToken, "rt-2")
    }

    func testInvalidCredentials400() throws {
        MockAuthProtocol.handler = { _ in
            (400, Data(#"{"error":"invalid_grant","error_description":"Invalid login credentials"}"#.utf8), nil)
        }
        let client = try makeClient()
        let exp = expectation(description: "login")
        var error: AuthError?
        client.login(email: "a@b.c", password: "wrong") {
            if case .failure(let e) = $0 { error = e }
            exp.fulfill()
        }
        wait(exp)

        guard case .invalidCredentials = error else {
            XCTFail("应映射 invalidCredentials，实际：\(String(describing: error))")
            return
        }
    }

    func testUnauthorized401MapsToInvalidCredentials() throws {
        MockAuthProtocol.handler = { _ in
            (401, Data(#"{"msg":"Invalid API key"}"#.utf8), nil)
        }
        let client = try makeClient()
        let exp = expectation(description: "login")
        var error: AuthError?
        client.login(email: "a@b.c", password: "pw") {
            if case .failure(let e) = $0 { error = e }
            exp.fulfill()
        }
        wait(exp)
        guard case .invalidCredentials = error else {
            XCTFail("应映射 invalidCredentials，实际：\(String(describing: error))")
            return
        }
    }

    func testEmptyInputFailsFast() throws {
        let client = try makeClient()
        let exp = expectation(description: "login")
        var error: AuthError?
        client.login(email: "  ", password: "") {
            if case .failure(let e) = $0 { error = e }
            exp.fulfill()
        }
        wait(exp)
        guard case .invalidCredentials = error else {
            XCTFail("空输入应快速失败")
            return
        }
    }

    func testLogoutClearsSession() throws {
        MockAuthProtocol.handler = { _ in
            (200, Data(#"{"access_token":"at-3","refresh_token":"rt-3"}"#.utf8), nil)
        }
        let store = InMemorySessionStore()
        let client = try makeClient(store: store)
        let exp = expectation(description: "login")
        client.login(email: "a@b.c", password: "pw") { _ in exp.fulfill() }
        wait(exp)
        XCTAssertNotNil(client.savedSession)

        client.logout()
        XCTAssertNil(client.savedSession)
    }
}
