// AppDelegate.swift — 菜单栏 StatusItem 与菜单。
//
// M2 骨架 + M3 接线（FDA/解析/监听）+ M4a 引擎预载 + M4b rpc 注入 + M4c 登录：
//   - 启动检测 FDA → 状态行「已授权/未授权」；已授权启动 FSEvents 监听；
//   - 预载 core bundle（crypto 注入），有 Supabase 配置时注入真实 rpc；
//   - 启动恢复 Keychain 会话 → 注入 rpc 的 authToken；
//   - 菜单「登录…」（email/password）→ 成功后 token 注入 + 状态更新。

import AppKit
import BookmarkSyncCoreBridge
import BookmarkSyncPlist
import JavaScriptCore

/// 菜单栏 App 的应用代理。
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem?
    private var statusMenuItem: NSMenuItem?
    private var authMenuItem: NSMenuItem?
    private var monitor: BookmarksMonitor?
    /// M4a：启动时预加载 core bundle（JSContext + Swift crypto 注入），
    /// 后续 M5 的 SyncCoordinator 直接复用。
    private var coreContext: JSContext?
    private var coreEngineLoaded = false
    /// M4c：auth 客户端（有 Supabase 配置时构造）。
    private var authClient: SupabaseAuthClient?

    // MARK: - NSApplicationDelegate

    func applicationDidFinishLaunching(_ notification: Notification) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = NSImage(
                systemSymbolName: "bookmark.fill",
                accessibilityDescription: "Bookmark Sync"
            )
        }
        item.menu = buildMenu()
        self.statusItem = item
        refreshAccessStatus()
        preloadCoreEngine()
        restoreSession()
    }

    /// M4a：预加载 core bundle（Swift crypto 注入）。失败只记录，不阻塞菜单栏启动。
    /// M4b：有 Supabase 环境变量配置时注入真实 rpc 客户端，否则退化为占位。
    /// M4c：构造 auth 客户端（登录用）。
    private func preloadCoreEngine() {
        do {
            let supabase = SupabaseRpcClient.fromEnvironment()
            coreContext = try CoreBridge.loadBundle(supabase: supabase)
            coreEngineLoaded = true
            if let supabase {
                authClient = SupabaseAuthClient(config: supabase)
            }
            print(
                "[bsync-mac] core bundle 已加载（Swift crypto 注入生效；" +
                "rpc=\(supabase == nil ? "占位(未配置)" : "真实 URLSession")）"
            )
        } catch {
            coreEngineLoaded = false
            print("[bsync-mac] core bundle 加载失败: \(error.localizedDescription)")
        }
    }

    /// M4c：App 启动恢复 Keychain 会话 → rpc 注入用户 token（免重复登录）。
    private func restoreSession() {
        guard let session = authClient?.savedSession else { return }
        CoreBridge.lastRpcClient?.setAuthToken(session.accessToken)
        print("[bsync-mac] 已恢复会话: \(session.email ?? session.userId ?? "unknown")")
        refreshAuthMenuItem()
    }

    // MARK: - 菜单

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()

        let statusItem = NSMenuItem(title: "书签同步 · 检测中…", action: nil, keyEquivalent: "")
        statusItem.isEnabled = false
        menu.addItem(statusItem)
        self.statusMenuItem = statusItem

        menu.addItem(.separator())

        menu.addItem(
            NSMenuItem(
                title: "打开设置…",
                action: #selector(openSettings),
                keyEquivalent: ","
            )
        )

        menu.addItem(
            NSMenuItem(
                title: "重新检查访问权限",
                action: #selector(refreshAccessStatus),
                keyEquivalent: "r"
            )
        )

        let authItem = NSMenuItem(title: "登录…", action: #selector(toggleAuth), keyEquivalent: "l")
        menu.addItem(authItem)
        self.authMenuItem = authItem

        menu.addItem(.separator())

        menu.addItem(
            NSMenuItem(
                title: "退出",
                action: #selector(NSApplication.terminate(_:)),
                keyEquivalent: "q"
            )
        )

        return menu
    }

    /// 登录菜单项标题随状态切换：未登录「登录…」/ 已登录「退出登录（email）」。
    private func refreshAuthMenuItem() {
        guard let session = authClient?.savedSession else {
            authMenuItem?.title = "登录…"
            return
        }
        authMenuItem?.title = "退出登录（\(session.email ?? "已登录")）"
    }

    // MARK: - FDA 状态与监听

    /// 检测 FDA 授权状态，更新菜单状态行；已授权时确保监听在跑。
    @objc private func refreshAccessStatus() {
        let granted = FullDiskAccess.canReadBookmarks()
        statusMenuItem?.title = granted ? "书签同步 · 已授权" : "书签同步 · 未授权"
        if granted {
            startMonitorIfNeeded()
        }
        refreshAuthMenuItem()
    }

    private func startMonitorIfNeeded() {
        guard monitor == nil else { return }
        let directory = (SafariBookmarks.plistPath as NSString).deletingLastPathComponent
        let monitor = BookmarksMonitor(directory: directory) { [weak self] in
            DispatchQueue.main.async {
                self?.onBookmarksChanged()
            }
        }
        monitor.start()
        self.monitor = monitor
        print("[bsync-mac] FSEvents 监听已启动: \(directory)")
    }

    /// 书签文件变更事件（M3 只验证可达性；M5 在这里接只读上行）。
    private func onBookmarksChanged() {
        print("[bsync-mac] Bookmarks.plist 变更事件 @ \(Date())")
        // TODO(M5)：plist 树 → MoveOps → SyncCoordinator → bsync_op_push
    }

    // MARK: - Actions

    /// 打开设置：未授权 → 引导 FDA；已授权 → 显示书签统计与引擎/会话状态。
    @objc private func openSettings() {
        if FullDiskAccess.canReadBookmarks() {
            showBookmarkSummary()
        } else {
            promptFullDiskAccess()
        }
    }

    private func showBookmarkSummary() {
        let bookmarks = FullDiskAccess.loadBookmarks() ?? []
        let stats = SafariBookmarks.stats(of: bookmarks)
        let session = authClient?.savedSession
        let alert = NSAlert()
        alert.messageText = "Safari 书签读取正常"
        alert.informativeText = """
        文件夹 \(stats.folders) 个 · 书签 \(stats.bookmarks) 条 · 阅读列表 \(stats.reading) 条

        已启动 FSEvents 监听：书签文件变更会触发同步上传（M5 实现）。
        核心引擎：\(coreEngineLoaded ? "已加载" : "未加载\(coreContext == nil ? "（先 pnpm build:core）" : "")")
        登录：\(session == nil ? "未登录" : "\(session!.email ?? "已登录")")
        路径：\(SafariBookmarks.plistPath)
        """
        alert.runModal()
    }

    /// 登录 / 退出登录切换（M4c）。
    @objc private func toggleAuth() {
        if authClient?.savedSession != nil {
            authClient?.logout()
            CoreBridge.lastRpcClient?.setAuthToken(nil)
            refreshAuthMenuItem()
            showAlert("已退出登录", "本地会话已清除。")
            return
        }
        performLogin()
    }

    private func performLogin() {
        guard let authClient else {
            showAlert(
                "未配置 Supabase",
                "设置环境变量 BOOKMARK_SYNC_SUPABASE_URL / BOOKMARK_SYNC_SUPABASE_ANON_KEY 后重启 App。"
            )
            return
        }

        let alert = NSAlert()
        alert.messageText = "登录 Supabase"
        alert.informativeText = "使用扩展同一账号（邮箱 + 密码）"
        alert.addButton(withTitle: "登录")
        alert.addButton(withTitle: "取消")

        let emailField = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        emailField.placeholderString = "邮箱"
        let passwordField = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        passwordField.placeholderString = "密码"
        let stack = NSStackView(views: [emailField, passwordField])
        stack.orientation = .vertical
        stack.spacing = 8
        alert.accessoryView = stack

        guard alert.runModal() == .alertFirstButtonReturn else { return }

        let email = emailField.stringValue
        let password = passwordField.stringValue
        authClient.login(email: email, password: password) { [weak self] result in
            switch result {
            case .success(let session):
                CoreBridge.lastRpcClient?.setAuthToken(session.accessToken)
                self?.refreshAuthMenuItem()
                self?.showAlert("已登录", "欢迎，\(session.email ?? email)")
                print("[bsync-mac] 登录成功: \(session.email ?? "unknown")")
            case .failure(let error):
                self?.showAlert("登录失败", error.localizedDescription)
            }
        }
    }

    private func promptFullDiskAccess() {
        let alert = NSAlert()
        alert.messageText = "需要「完全磁盘访问」"
        alert.informativeText = """
        读取 Safari 书签（~/Library/Safari/Bookmarks.plist）需要授予本应用完全磁盘访问：

        系统设置 → 隐私与安全性 → 完全磁盘访问 → 添加并勾选 BookmarkSyncMenu

        授权后回到本菜单点「重新检查访问权限」。
        """
        alert.addButton(withTitle: "打开系统设置")
        alert.addButton(withTitle: "重新检查")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            FullDiskAccess.openSystemSettings()
        }
        refreshAccessStatus()
    }

    // MARK: - 通用弹窗

    private func showAlert(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }
}
