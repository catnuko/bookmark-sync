# bookmark-sync 项目长期记忆

## 项目构成
- 根项目：Chrome MV3 扩展（`src/` → vite build → `extension/`），书签通过 Supabase 快照方案跨浏览器同步（JSON 快照 + 配额校验 + Pro 门控），另有 `website/`（Vue3 + vite，Vercel 部署，独立 lockfile、独立 vercel.json）与 `supabase/`(SQL)。
- 源目录即真相：扩展逻辑在 `src/`（`sync.js` 同步引擎、`lib/ext.js` API 注入、`lib/supabase.js`、`App.vue` popup、`background.js` service worker）。`extension/` 是构建产物，勿直接改。

## Safari 移植
- 工程：`bookmark-sync/`（Xcode 模板，macOS + iOS 双 target）。web 扩展本体在 `Shared (Extension)/Resources/`。
- 同步脚本：`bookmark-sync/sync-extension.sh`（幂等，把 `../extension` 同步进 Resources 并补 manifest icons）。
- 构建自动化：`pnpm build` = `vite build && node scripts/post-build-safari.mjs`（同步 → 平台判断 → 有 Xcode 则 xcodebuild → 分级日志）。xcodebuild 用 `-target "bookmark-sync (macOS)" -configuration Debug CODE_SIGNING_ALLOWED=NO`（工程无 shared scheme）。
- folder-sync 坑：Xcode 16 folder-sync 下**子目录**必须列在 `PBXFileSystemSynchronizedRootGroup.explicitFolders` 才会进 appex（仅在 membershipExceptions 里写无效）。已把 `Resources/assets` 加入。

## ★ 硬约束：Safari 不支持 bookmarks API（macOS + iOS 皆然）
- Apple 2011 年移除 Safari 书签 API，2020 引入 WebExtensions 时未实现 `bookmarks`，至今（Safari 26）仍 "not supported"。官方论坛工程师确认；MDN 兼容表 Safari / Safari on iOS 均为 No support。
- 后果：本项目核心同步逻辑依赖 `api.bookmarks.*`（无降级分支），**在 Safari 上必然失败** —— 扩展 UI 能开、能登录，但「立即同步」必报错。macOS Safari 与 iOS Safari 都一样。
- iOS 另有门槛：扩展不可侧载，只能经 App Store 分发；iOS 不支持 webRequest / contextMenus / windows.*；且 iOS 全体浏览器强制 WebKit，换 Chrome/Edge 也无效 → iOS 上"浏览器扩展同步书签"不可行。
- **出路（macOS）**：Safari 书签是明文文件 `~/Library/Safari/Bookmarks.plist`，原生 macOS App 可直读直写。前提：macOS (App) target **关闭 App Sandbox**（`ENABLE_APP_SANDBOX = NO`，工程当前为 YES）+ 用户授予**完全磁盘访问**。注意 **FDA 不解除沙盒**（Apple 官方确认），且 FDA 不是 entitlement → 无法上架 Mac App Store。实测本机该文件 4.78 MB 且被 TCC 拒读；`SafariBookmarksSyncAgent` 在跑（iCloud 同步已开）→ 写回有冲突风险，建议先做单向只读。
- **iOS**：直连无解。第三方 App/扩展均不能读 Safari 书签，iCloud 是唯一途径。
- **但可间接覆盖 iOS**：参考 BookMacster 的 "Bridge Mac" 模型 —— macOS App 单向写入 Mac 的 Safari 书签后，**iCloud 会自动同步到 iPhone Safari**，等于绕开 iOS 扩展死路。故 iOS 是"够不着但可中转"，非绝对堵死。

## 竞品参照：BookMacster（同问题域、不同架构、互补）
- Sheep Systems 的原生 macOS App（$24.95 买断）。定位 = 本机跨浏览器统一 + 本地中央库（`.bmco`）+ 书签整理（排序/去重/验链/HTTPS 升级/去追踪参数）。**无自有云**：跨设备靠"Bridge Mac"（一台常开 Mac 当桥）+ 浏览器自带同步（iCloud/Chrome Sync/Firefox Sync）当传输层。无账号、无 iOS、无 Windows。
- 与本项目关系：BookMacster 本地优先/无云/仅 macOS；本项目云优先/自有 Supabase/有账号/跨设备。两者短板互补（它缺云和 iOS，本项目缺 Safari 通路）。
- 可借鉴：① 它的 Safari 读取同样走 `Bookmarks.plist` + FDA（验证本项目路线成熟）；② Bridge Mac + iCloud 中转思路可解决 iPhone 覆盖；③ 其 sync 节流策略（变更后 0-5 分钟懒触发）可用作增量同步参考。
- **许可证：BookMacster 是闭源商业软件**（Proprietary，$22.95–24.95 买断），**不可读源码**。可参考行为、不可复用代码。
- **开源可复用替代（读 Safari Bookmarks.plist，均 MIT/Apache/Artistic）**：`safari_bookmarks_parser`（Ruby，MIT，plist→JSON/YAML + 查重）、`bookmark`（Rust，Apache-2.0，含 MCP server）、`App-bookmarks`(kal247)（Perl，Artistic-2.0，多浏览器导出）、`ReadingListReader`（Python，MIT，读阅读列表）。写原生 macOS App 时可优先参考这些解析器的 plist 结构处理。

## 用户约定
- 改代码前先对齐方案；不自动 commit/push（需明确授权）；视觉验证以截图对照参考实现为准。
