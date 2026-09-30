// AppDelegate.swift — 菜单栏 StatusItem 与菜单。
//
// M2 骨架 + M3 接线：
//   - 启动时检测 FDA（canReadBookmarks）→ 状态行显示「已授权 / 未授权」；
//   - 已授权 → 启动 FSEvents 监听（M5 上行的事件源）；
//   - 打开设置：未授权 → 弹窗引导深链系统设置；已授权 → 显示书签统计。

import AppKit
import BookmarkSyncPlist

/// 菜单栏 App 的应用代理。
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem?
    private var statusMenuItem: NSMenuItem?
    private var monitor: BookmarksMonitor?

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

    // MARK: - FDA 状态与监听

    /// 检测 FDA 授权状态，更新菜单状态行；已授权时确保监听在跑。
    @objc private func refreshAccessStatus() {
        let granted = FullDiskAccess.canReadBookmarks()
        statusMenuItem?.title = granted ? "书签同步 · 已授权" : "书签同步 · 未授权"
        if granted {
            startMonitorIfNeeded()
        }
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

    /// 打开设置：未授权 → 引导 FDA；已授权 → 显示书签统计与监听状态。
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
        let alert = NSAlert()
        alert.messageText = "Safari 书签读取正常"
        alert.informativeText = """
        文件夹 \(stats.folders) 个 · 书签 \(stats.bookmarks) 条 · 阅读列表 \(stats.reading) 条

        已启动 FSEvents 监听：书签文件变更会触发同步上传（M5 实现）。
        路径：\(SafariBookmarks.plistPath)
        """
        alert.runModal()
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
}
