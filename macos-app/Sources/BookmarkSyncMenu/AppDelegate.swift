// AppDelegate.swift — 菜单栏 StatusItem 与菜单（M2 骨架）。
//
// M2 只交付「能跑起来」的壳：菜单栏图标 + 状态行 + 设置占位 + 退出。
// 后续迭代把菜单项接到真实状态：
//   M3/M5 后：状态行显示真实同步状态（idle / syncing / error / 设备限额）；
//   M2 后半：设置面板（邮箱 OTP 登录 + FDA 引导 + 口令设置）挂到 openSettings。

import AppKit

/// 菜单栏 App 的应用代理。
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusItem: NSStatusItem?

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
    }

    // MARK: - 菜单

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()

        let statusItem = NSMenuItem(
            title: "书签同步 · 未配置",
            action: nil,
            keyEquivalent: ""
        )
        statusItem.isEnabled = false
        menu.addItem(statusItem)

        menu.addItem(.separator())

        menu.addItem(
            NSMenuItem(
                title: "打开设置…",
                action: #selector(openSettings),
                keyEquivalent: ","
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

    // MARK: - Actions

    /// 打开设置面板（M2 后半：邮箱 OTP 登录 + FDA 引导 + 口令设置）。
    @objc private func openSettings() {
        // TODO(M2 后半 / M3)：挂登录与 FDA 引导界面。
        // 当前骨架先弹一条说明，避免「点击无反应」。
        let alert = NSAlert()
        alert.messageText = "Bookmark Sync · macOS"
        alert.informativeText = """
        设置面板尚未实现（M2 骨架阶段）。

        路线：M3 plist 层（FDA + 解析 + FSEvents）→ M4 JSCore 桥（加载 core bundle）
              → M5 只读上行 → M6 安全双向写入。
        详见 docs/safari-core-bundle.md 与 macos-app/README.md。
        """
        alert.runModal()
    }
}
