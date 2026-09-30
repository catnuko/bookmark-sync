// swift-tools-version: 5.10
//
// BookmarkSyncMenu — Safari 书签同步的 macOS 菜单栏 App（P1/P2 载体）。
//
// 与仓库内已有 Xcode Safari Web Extension 壳工程（bookmark-sync/）相互独立：
// 本工程是「方案 2」的载体（见 docs/safari-sync-research.md §5）——
// 原生菜单栏 App 直读 ~/Library/Safari/Bookmarks.plist（FDA），
// 通过 JavaScriptCore 内嵌 dist/core/bookmark-sync-core.js 复用扩展同步引擎
// （协议零漂移，见 docs/safari-core-bundle.md），Supabase 会话走 Auth REST。
//
// 生命周期：
//   M2 本提交：可编译运行的菜单栏骨架（状态行 + 设置占位 + 退出）
//   M3：plist 层（FDA 引导 + 宽容解析 + FSEvents）
//   M4：JavaScriptCore 桥（注入 crypto / KVStore / SupabaseRpcClient，加载 core bundle）
//   M5：只读上行（plist 树 → MoveOps → SyncCoordinator → bsync_op_*）
//   M6：安全双向写入（退出 Safari + 时间戳备份 + 原子写）
//
// 注意：禁 App Sandbox（FDA 与沙箱冲突），不上 Mac App Store；
// 对外分发走 Developer ID 签名 + notarization（需付费开发者账号，后置）。

import PackageDescription

let package = Package(
    name: "BookmarkSyncMenu",
    platforms: [
        // macOS 11.3+ 的 JavaScriptCore 才提供 TextEncoder/TextDecoder（core bundle 依赖）。
        .macOS(.v13)
    ],
    targets: [
        // Plist 层（M3）：FDA + 宽容解析 + FSEvents，独立 library 便于 XCTest。
        .target(
            name: "BookmarkSyncPlist",
            path: "Sources/BookmarkSyncPlist"
        ),
        .executableTarget(
            name: "BookmarkSyncMenu",
            dependencies: ["BookmarkSyncPlist"],
            path: "Sources/BookmarkSyncMenu"
        ),
        .testTarget(
            name: "BookmarkSyncPlistTests",
            dependencies: ["BookmarkSyncPlist"],
            path: "Tests/BookmarkSyncPlistTests"
        ),
    ]
)
