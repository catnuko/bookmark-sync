// SupabaseRpcClient.swift — 真实 rpc 客户端（M4b，URLSession 实现）。
//
// 对齐 src/sync/oplogClient.ts 的 SupabaseRpcClient 契约：
//   rpc(fn, args) => Promise<{ data: unknown; error: unknown }>
// 传输层（SupabaseOpLogTransport）只消费 data / error 两个字段：
//   error 非空 → transport 抛 rpcError；data = RPC 返回体（如 { inserted, gc_needed }）。
//
// 请求形态（与扩展的 @supabase/supabase-js 对齐）：
//   POST https://<project-ref>.supabase.co/rest/v1/rpc/<fn>
//   Header: apikey: <anon key>, Authorization: Bearer <anon key 或用户 token>,
//           Content-Type: application/json
//   Body:   JSONSerialization(args)
//
// 异步模型（JSC 微任务限制，见 docs/safari-core-bundle.md §4）：
//   JS 侧 new Promise(res, rej)，Swift 把 res/rej 立即取到局部 JSValue 持有
//   （避免并发覆盖全局占位），URLSession 完成回调 dispatch 回 JSContext 所在
//   线程（主线程）后调用 res/rej —— JSValue 调用与 JSContext 同线程亲和。
//
// 配置：开发期从环境变量读取（BOOKMARK_SYNC_SUPABASE_URL / _ANON_KEY），
// 不进 git；未配置时返回 nil，由 CoreLoader 退化为占位 rpc（快速失败）。

import Foundation
import JavaScriptCore

public final class SupabaseRpcClient {

    public struct Config {
        public let projectURL: String // 形如 https://<project-ref>.supabase.co
        public let anonKey: String
        public let authToken: String? // M5 登录会话后注入（Bearer 优先用用户 token）

        public init(projectURL: String, anonKey: String, authToken: String? = nil) {
            self.projectURL = projectURL
            self.anonKey = anonKey
            self.authToken = authToken
        }
    }

    private let config: Config
    private let session: URLSession

    public init(config: Config, session: URLSession = .shared) {
        self.config = config
        self.session = session
    }

    /// 从环境变量读取配置（开发期；M5 前不引入设置面板/Keychain）。
    /// 两个变量缺一不可；缺任一返回 nil（不抛错，调用方决定占位策略）。
    public static func fromEnvironment() -> Config? {
        let env = ProcessInfo.processInfo.environment
        guard let url = env["BOOKMARK_SYNC_SUPABASE_URL"], !url.isEmpty,
              let key = env["BOOKMARK_SYNC_SUPABASE_ANON_KEY"], !key.isEmpty
        else { return nil }
        return Config(projectURL: url, anonKey: key)
    }

    // MARK: - 注入对象

    /// 构造注入 JS 的 rpc 客户端对象（{ rpc(fn, args) -> Promise }）。
    public func makeRpcObject(in context: JSContext) -> JSValue {
        let rpc = JSValue(newObjectIn: context)!
        rpc.setObject(makeRpcBlock(context: context), forKeyedSubscript: "rpc" as NSString)
        return rpc
    }

    private func makeRpcBlock(context: JSContext) -> @convention(block) (String, JSValue) -> JSValue {
        let baseURL = config.projectURL
        let apikey = config.anonKey
        let bearer = config.authToken ?? config.anonKey
        let session = self.session

        let block: @convention(block) (String, JSValue) -> JSValue = { fn, args in
            let ctx = JSContext.current() ?? context

            // 1) 创建 JS Promise，立即取走 res/rej（局部持有，避免并发覆盖）。
            //    （evaluateScript 返回 IUO；脚本为常量，必然成功，直接解包。）
            let promise = ctx.evaluateScript(
                "(function(){ return new Promise(function(res, rej){ globalThis.__bsync_rpc_pending = [res, rej]; }); })()"
            )!
            let pending = ctx.objectForKeyedSubscript("__bsync_rpc_pending")
            guard let resolve = pending?.objectAtIndexedSubscript(0) else {
                return JSValue(undefinedIn: ctx)
            }

            // 2) 构造请求（fn 仅由引擎代码调用，固定 4 个白名单 RPC，无注入风险）。
            //    契约：rpc 必须 resolve { data, error }（transport 用
            //    `const { data, error } = await rpc(...)` 解构；reject 会让解构崩掉）。
            guard let url = URL(string: baseURL + "/rest/v1/rpc/" + fn) else {
                DispatchQueue.main.async {
                    _ = resolve.call(withArguments: [[
                        "data": NSNull(),
                        "error": ["code": "BAD_CONFIG", "message": "Supabase URL 非法：\(baseURL)"],
                    ]])
                }
                return promise
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(apikey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer " + bearer, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                let jsonData = try JSONSerialization.data(withJSONObject: args.toObject() ?? [:])
                request.httpBody = jsonData
            } catch {
                DispatchQueue.main.async {
                    _ = resolve.call(withArguments: [[
                        "data": NSNull(),
                        "error": ["code": "BAD_ARGS", "message": "args JSON 序列化失败：\(error)"],
                    ]])
                }
                return promise
            }

            // 3) 异步请求；完成回调切回 JSContext 线程（主线程）调用 resolve。
            session.dataTask(with: request) { data, response, error in
                DispatchQueue.main.async {
                    if let error {
                        _ = resolve.call(withArguments: [[
                            "data": NSNull(),
                            "error": ["code": "NETWORK", "message": error.localizedDescription],
                        ]])
                        return
                    }
                    var bodyMessage: String?
                    var parsed: Any?
                    if let data, !data.isEmpty {
                        parsed = try? JSONSerialization.jsonObject(with: data)
                        if let dict = parsed as? [String: Any],
                           let msg = dict["message"] as? String
                        {
                            bodyMessage = msg
                        } else if let msg = parsed as? String {
                            bodyMessage = msg
                        }
                    }

                    if let status = (response as? HTTPURLResponse)?.statusCode,
                       !(200...299).contains(status)
                    {
                        // PostgREST 错误体可能带 message；兜底用 HTTP 状态描述。
                        _ = resolve.call(withArguments: [[
                            "data": NSNull(),
                            "error": ["code": status, "message": bodyMessage ?? "HTTP \(status)"],
                        ]])
                        return
                    }
                    // 成功：data = RPC 返回体（null 时返回 NSNull → JS null），error = null。
                    _ = resolve.call(withArguments: [[
                        "data": parsed ?? NSNull(),
                        "error": NSNull(),
                    ]])
                }
            }.resume()

            return promise
        }
        return block
    }
}
