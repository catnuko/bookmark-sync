// SupabaseAuthClient.swift — email/password 登录 + 会话管理（M4c）。
//
// 对齐扩展（@supabase/supabase-js signInWithPassword → GoTrue）：
//   POST {projectURL}/auth/v1/token?grant_type=password
//   Header: apikey: <anon key>, Content-Type: application/json
//   Body:   { "email": ..., "password": ... }
//   200 → { access_token, refresh_token, user: { id, email }, ... }
//   400 invalid_grant → 邮箱或密码错误
//
// 会话持久化：Keychain（正式凭据，不用 UserDefaults）；测试注入内存 store。
// refresh token 轮换（GoTrue 刷新语义）留待 M5 接入 RPC 401 处理时一起做。

import Foundation
import Security

/// 登录会话（access_token 短效，refresh_token 用于轮换）。
public struct AuthSession: Codable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let userId: String?
    public let email: String?

    public init(accessToken: String, refreshToken: String, userId: String?, email: String?) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.userId = userId
        self.email = email
    }
}

/// 会话存储抽象（App = Keychain；测试 = 内存）。
public protocol SessionStore {
    func save(_ session: AuthSession) throws
    func load() -> AuthSession?
    func clear()
}

/// Keychain 实现：service = com.catnuko.bookmark-sync / account = supabase-session。
public final class KeychainSessionStore: SessionStore {

    private let service: String
    private let account: String

    public init(service: String = "com.catnuko.bookmark-sync", account: String = "supabase-session") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func save(_ session: AuthSession) throws {
        let data = try JSONEncoder().encode(session)
        let query = baseQuery.merging([
            kSecValueData as String: data,
        ]) { _, new in new }

        // 先删后加（幂等更新；SecItemUpdate 也行，但简单路径更稳）。
        SecItemDelete(baseQuery as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw AuthError.keychain(status)
        }
    }

    public func load() -> AuthSession? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    public func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}

/// 登录错误（面向 UI 的可读信息）。
public enum AuthError: LocalizedError {
    case invalidCredentials
    case network(String)
    case unexpected(String)
    case keychain(OSStatus)

    public var errorDescription: String? {
        switch self {
        case .invalidCredentials: return "邮箱或密码错误"
        case .network(let message): return "网络错误：\(message)"
        case .unexpected(let message): return "登录失败：\(message)"
        case .keychain(let status): return "凭据保存失败（\(status)）"
        }
    }
}

/// email/password 登录客户端（URLSession 实现 GoTrue /auth/v1/token）。
public final class SupabaseAuthClient {

    private let config: SupabaseRpcClient.Config
    private let session: URLSession
    private let store: SessionStore

    public init(
        config: SupabaseRpcClient.Config,
        session: URLSession = .shared,
        store: SessionStore = KeychainSessionStore()
    ) {
        self.config = config
        self.session = session
        self.store = store
    }

    /// 已保存的会话（App 启动时恢复，避免每次都要登录）。
    public var savedSession: AuthSession? {
        store.load()
    }

    /// email + password 登录；成功回调在主线程，会话已持久化。
    public func login(
        email: String,
        password: String,
        completion: @escaping (Result<AuthSession, AuthError>) -> Void
    ) {
        let trimmed = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !password.isEmpty else {
            DispatchQueue.main.async {
                completion(.failure(.invalidCredentials))
            }
            return
        }

        guard let url = URL(string: config.projectURL + "/auth/v1/token?grant_type=password") else {
            DispatchQueue.main.async {
                completion(.failure(.unexpected("URL 非法：\(self.config.projectURL)")))
            }
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "email": trimmed,
                "password": password,
            ])
        } catch {
            DispatchQueue.main.async {
                completion(.failure(.unexpected("请求体序列化失败：\(error)")))
            }
            return
        }

        session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    completion(.failure(.network(error.localizedDescription)))
                    return
                }
                guard let data else {
                    completion(.failure(.network("空响应")))
                    return
                }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                do {
                    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        completion(.failure(.unexpected("响应格式异常")))
                        return
                    }
                    guard (200...299).contains(status) else {
                        // GoTrue：400 + error_code=invalid_grant → 凭据错误；其余走原文。
                        if status == 400 || status == 401 {
                            completion(.failure(.invalidCredentials))
                        } else {
                            let message = json["msg"] as? String ?? "HTTP \(status)"
                            completion(.failure(.unexpected(message)))
                        }
                        return
                    }
                    guard let accessToken = json["access_token"] as? String,
                          let refreshToken = json["refresh_token"] as? String
                    else {
                        completion(.failure(.unexpected("响应缺少 access_token/refresh_token")))
                        return
                    }
                    let user = json["user"] as? [String: Any]
                    let session = AuthSession(
                        accessToken: accessToken,
                        refreshToken: refreshToken,
                        userId: user?["id"] as? String,
                        email: user?["email"] as? String ?? trimmed
                    )
                    try? self.store.save(session)
                    completion(.success(session))
                } catch {
                    completion(.failure(.unexpected("响应解析失败：\(error)")))
                }
            }
        }.resume()
    }

    /// 退出登录（清除本地会话；不调用 GoTrue logout，token 交给客户端自然过期）。
    public func logout() {
        store.clear()
    }
}
