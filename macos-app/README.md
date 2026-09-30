# macos-app —— BookmarkSyncMenu（菜单栏 App）

Safari 书签同步的 macOS 原生载体（P1/P2，对应 `docs/safari-sync-research.md` §5 方案 2）。

## 为什么是菜单栏 App

- Safari 无 bookmarks API（macOS + iOS 均不支持），唯一程序化通道是直读写
  `~/Library/Safari/Bookmarks.plist`，需要「完全磁盘访问」（FDA / TCC）。
- 同步引擎不重写：通过 JavaScriptCore 加载 `dist/core/bookmark-sync-core.js`
  （`src/core/entry.ts` 打包，见 `docs/safari-core-bundle.md`），
  **扩展与 macOS App 跑同一份 CRDT + 加密 + 传输代码**。

## 构建与运行

```bash
cd macos-app
swift build                 # 编译 → .build/debug/BookmarkSyncMenu
swift run                   # 运行（菜单栏出现 bookmark.fill 图标）
```

无 Xcode 工程、无 Info.plist、纯 SwiftPM。签名/公证/打包留到分发阶段。

## 模块规划（按迭代顺序）

| 阶段 | 模块 | 内容 |
| --- | --- | --- |
| M2（当前） | 骨架 | 菜单栏 StatusItem + 状态行/设置占位/退出，可编译可运行 |
| M2 后半 | Auth / Keychain | 邮箱 OTP 登录（Supabase Auth REST），会话 token + deviceId + 口令派生盐入 Keychain |
| M3 | Plist | FDA 检测/引导（深链系统设置）、Bookmarks.plist 宽容解析（fixture 测试矩阵）、FSEvents 监听 |
| M4 | CoreBridge | JavaScriptCore：注入 crypto（CryptoKit）/ KVStore / SupabaseRpcClient（URLSession），加载 core bundle |
| M5 | Sync | plist 树 → MoveOps → SyncCoordinator → bsync_op_*（只读上行，作为一台设备计入 device_limit） |
| M6 | WriteBack | 安全双向写入：检测 Safari 运行 → 提示退出 → 时间戳备份 N 份 → 原子写 → iCloud 传播防回灌 |

## 硬约束

- **禁 App Sandbox**（FDA 与沙箱冲突）；不上 Mac App Store。
- 分发需 Developer ID 签名 + notarization（$99/年付费账号，当前未注册 → 分发后置，本地调试用免费 Apple ID）。
- 设备限额：迁移 0033 `device_limit` 会把 macOS App 计为一台设备（replicaId = deviceId），计费文案随 M5 确认。
