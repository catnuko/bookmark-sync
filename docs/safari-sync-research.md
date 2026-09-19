# Safari 书签同步：开源方案调研与选型报告

> 调研时间：2026-09-19 · 背景：`feat-macos` 分支立项依据
> 数据来源：GitHub Search/REST API（star 数与活跃度为当日实况）、MDN browser-compat-data、各项目 README

## TL;DR

1. **纯浏览器扩展路线在 Safari 上被 Apple 封死**：`bookmarks` API 在 Safari（桌面 + iOS）均为不支持（MDN BCD 实测 `version_added: false`，Chrome 3+ / Edge 15+ / Firefox 45+ 均支持）。floccus（8.5k★）等所有主流开源书签同步扩展因此全部放弃 Safari，这不是工程问题，是 API 缺席。
2. **GitHub 上不存在成熟的双向 Safari ⇄ Chromium/Firefox 开源同步器**。所有真实先例（合计不到 50★）走的是同一条路：**原生 macOS App 读写 `~/Library/Safari/Bookmarks.plist`（需完全磁盘访问）+ 云端中转 + 浏览器扩展负责 Chromium/Firefox 侧**。路线已被验证可行，但没人做成"多设备、双向、带删除传播"。
3. **推荐方案：新增一个 Swift 原生菜单栏 App 作为"一台正式设备"直连现有 Supabase**，用 JavaScriptCore 内嵌现有 TS 同步引擎（协议实现零漂移）；Safari 侧先做只读上行，第二步再做安全写入。同时立即上线零成本的 HTML 导入/导出兜底（P0）。

---

## 1. 边界事实：Safari 侧能做什么、不能做什么

| 通道 | 结论 | 依据 |
| --- | --- | --- |
| Safari Web Extension 的 `bookmarks` API | **不支持**（桌面 Safari 与 iOS 均 `version_added: false`） | MDN browser-compat-data `webextensions/api/bookmarks.json`（2026-09 实查）；floccus issue #23（open）、floccus FAQ "Safari is currently not supported" |
| AppleScript 自动化 | **无书签类**。`bookmark folder`/`bookmark item` 只存在于 Chrome/Chromium 字典；Safari 只暴露窗口/标签 | MacScripter/Apple 支持社区多轮确认；现有脚本只能走 plist |
| `Bookmarks.plist` 直读直写 | **唯一程序化通道**。`~/Library/Safari/Bookmarks.plist`，二进制 plist，含书签栏/书签菜单/阅读列表；macOS 10.14+ 受 TCC 保护，读写需**完全磁盘访问（FDA）** | evilmarty/safari-bookmarks-cli、BridgeMark、dubo78 等项目 README 一致 |
| 写入可行性 | **已验证**：safari-bookmarks-cli（30★）支持 add/move/remove，且 Safari 检测到文件变化会自动重载；社区惯例是"目标浏览器运行时拒写/先退出 + 时间戳备份" | 见 §2.2/§2.3 |
| iCloud | Safari 书签经 iCloud 同步 → **写入 plist 后 iCloud 自动传播到 iPhone/iPad**，这是触达 iOS 的唯一路径；反向风险：其它浏览器原生云同步会把旧数据"回灌"本地（roanpy 项目记录了 Edge 的实际案例与修复策略） | roanpy/browser-bookmark-sync README、mickpletcher README |
| iOS/iPhone 扩展 | 无任何程序化通道（`safari_ios` 同样不支持 bookmarks API） | MDN BCD |
| 分发 | 此类 App 需 FDA → **不能上 Mac App Store**；走 Developer ID 签名 + 公证 + DMG | BridgeMark："Requires Hardened Runtime + Apple notarization" |

## 2. GitHub 开源方案全景

### 2.1 纯扩展同步器：无一支持 Safari

| 项目 | Star | 中转介质 | Safari | 备注 |
| --- | --- | --- | --- | --- |
| floccusaddon/floccus | 8,468 | WebDAV / Nextcloud / EteSync 等 | ❌ | 最成熟的开源书签同步；FAQ 明确不支持 Safari；issue #23 长期 open；其 iOS App 只能自建列表，无法碰原生书签 |
| xbrowsersync/app | 1,731 | 自建 REST API | ❌ | 后继项目 MarkSyncOrg/app-next（MV3 重写，5★）同样无 Safari |
| Cleod9/syncmarx-webext | 116 | 云盘中转 | ❌ | — |
| dodying/Bookmark-Sync | 63 | GitHub Gist | ❌ | — |
| Hishengs/bookmark-syncer | 70 | — | ❌ | — |
| Yueby/bookmark-syncer | 44 | WebDAV 自托管 | ❌ | — |
| d0dg3r/GitSyncMarks | 40 | Git 仓库（每书签一 JSON + 三方合并） | ❌ | 架构上最有参考价值的合并模型，但仍无 Safari |

**共同点**：云端文件/自建服务中转 + `chrome.bookmarks` 读写。Safari 缺 API，这一类天花板到此为止。

### 2.2 Safari plist 工具层：读写通道已被充分验证

- 只读解析：dgl/go-safari-bookmarks（16★，Go）、deanishe/go-safari（43★，归档）、healthypackrat/safari_bookmarks_parser（RubyGems）、tombooth/Bookmarks（8★，Swift）、nelsonlove/safari-py（2★）
- **增删改（写路径存在）**：evilmarty/safari-bookmarks-cli（30★，Apache-2.0，2026-09 仍活跃，支持 list/add/move/remove/empty，明确标注 FDA 要求）；robperc/SafariBookmarkEditor（26★，2016，Python plist 增删移位，无 license）

### 2.3 Safari ⇄ 其它浏览器同步先例：全部为个人项目量级

| 项目 | Star | 技术栈 | 方向 | 对本项目的价值 |
| --- | --- | --- | --- | --- |
| dubo78/Safari_bookmarks_Sync | 2 | Swift(SwiftUI) + Chrome 扩展 + GitHub Gist | 单向 Safari→Chromium | **与本项目的架构几乎同构**（原生 App + 扩展 + 云中转）；Keychain 存凭据、FDA 引导流程可直接借鉴 |
| roanpy/browser-bookmark-sync | 3 | Python CLI + 小型 macOS App | 6 浏览器本地镜像（Chrome/Edge/Safari/Brave/Vivaldi/Opera），replace 型 + 备份回滚 | 文档质量最高；**首次系统记录"原生云同步回灌旧数据"问题**及修复策略（逐 target 记录漂移 → 云结算 → 恢复） |
| TheSawkit/BridgeMark | 3 | Swift 6 (SPM) | 单向 Safari 书签栏→Chromium（Chrome/Edge/Brave/Opera/Vivaldi/Arc） | **安全写入守则范本**：合并/覆盖双模式、时间戳备份保留 5 份、目标浏览器运行时拒写、FDA 引导直达系统面板、Hardened Runtime + 公证分发 |
| mickpletcher/browser-bookmark-tool | 2 | Python，Win+macOS | Chrome↔Edge 保守 union 同步；Safari **刻意只读**（写入列为未来项 FUT-011） | 反向印证：Safari 写入被多个作者视为高风险而搁置；其"引导用户手动 HTML 导入"即本报告 P0 方案 |
| jiuliwei/AppleScript_to_automatically_sync_Safari_from_Chrome | 8 | AppleScript + launchd | 单向 Chrome→Safari（UI 自动化模拟"从 Chrome 导入"菜单） | **反面教材**：需明文存放 Mac 密码、合盖失效、只能全量重置 |

### 2.4 绕开原生书签的形态（对照，不符合本项目定位）

- 开源书签管理器（linkding / linkwarden / karakeep）：扩展把书签存进自建库，不碰原生书签树。
- Raindrop.io（商业）：有 Safari 扩展，但管理的是自家收藏，不做原生书签同步。
- Apple 官方 iCloud Bookmarks（Windows 版 iCloud + Chrome 扩展，闭源）：Apple 自己也只做了"iCloud 中转"这一条路，且仅限 Windows。

### 2.5 小结

- 需求真实存在（floccus issue 区、各 App Store 评论长期有人要 Safari 支持），但**没有现成轮子**：最大的相关项目 floccus 明确绕开，原生桥接项目全部 ≤3★、单人维护、多数单向。
- 可借鉴的不是"整个方案"，而是**安全细节**：plist 安全写入流程（BridgeMark）、云回灌防护（roanpy）、CRUD 通道（safari-bookmarks-cli）、分发要求（Hardened Runtime + 公证）。

## 3. 本项目的接入面

当前客户端协议面（`src/sync/oplogClient.ts`，v2 CRDT 契约）：

- 4 个 RPC：`bsync_op_push(p_space, p_device, p_ops)` / `bsync_op_pull(p_space, p_after_id, p_limit)` / `bsync_snapshot_pull` / `bsync_op_maybe_gc`
- op 为**整树 MoveOp 的操作级 E2EE 信封**（12B IV + AES-256-GCM，base64url）；密钥 = 口令 + 每用户随机盐派生
- per-device seq = CRDT Lamport 计数；**deviceId 即 CRDT replicaId**（0014 spaces_devices；0033 device_limit 按设备计数）
- 本地 CRDT：`src/crdt/`（moveCrdt / fractionalIndex / timestamp / replica）

一个新客户端（原生 macOS App）要参与同一同步网络，需要实现：① plist ⇄ 树模型转换；② CRDT replica；③ AES-256-GCM 口令派生加密（CryptoKit 与 WebCrypto 对齐）；④ 4 个 RPC 调用；⑤ FDA 引导、FSEvents 监听、菜单栏 UI。其中 ②③ 是唯一有"双实现漂移"风险的部分。

## 4. 候选方案对比与选型

| # | 方案 | 可行性 | 开发量 | 协议复用 | 运行条件 | 主要风险 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Safari Web Extension | ❌ 一票否决 | — | — | — | bookmarks API 不支持（§1） |
| 2 | **原生菜单栏 App 直连 Supabase，JSCore 内嵌现有 TS 引擎**（推荐） | ✅ | 中 | **完整复用，零漂移** | 独立常驻，不依赖浏览器在线 | JSC 桥接（fetch/crypto shim）、plist 解析 |
| 3 | 原生 App，Swift 重写协议 | ✅ | 大 | 双实现（漂移风险） | 独立常驻 | moveCrdt/fractionalIndex/E2EE 复刻正确性 |
| 4 | Native Messaging 薄桥（扩展当大脑，host 只做 plist⇄stdio） | ✅ | 小 | 完整复用（扩展侧） | **必须有 Chromium 浏览器在线** | Safari 无独立设备身份 → 墓碑/删除归属语义混乱；三家浏览器 NMH 安装；若给 host 独立身份 + 联网能力，实质就变成了方案 2 |
| 5 | HTML 导入/导出兜底 | ✅ | 极小（1–2 天） | 无需 | 手动 | 无自动性，但零风险 |
| 6 | 本地镜像工具型（roanpy 式，无服务器） | ✅ | 中 | 另起炉灶 | 本机 | 与本项目云端多设备架构冲突，等于第二套产品 |

**选型结论：方案 2 为主，方案 5 作为 P0 先行。**

理由：

- 协议面只有 4 个 RPC + 一个整树 op 模型，**op 是"整树 MoveOp 加密信封"而非细粒度事件流**，这使得 JSCore 复用整个 sync bundle 后，Swift 壳只需提供 plist I/O、URLSession fetch shim、CryptoKit crypto shim 三块桥接，无 CRDT 复刻风险。
- deviceId = replicaId 的设计让原生 App 天然就是"一台设备"，与 0033 device_limit、spaces 语义完全对齐；密钥从 `chrome.storage.local` 迁到 Keychain。
- 方案 4 看似省事，但本项目协议的设备身份语义（墓碑/删除归属、设备计数）决定了 Safari 必须是独立设备，绕了一圈还是方案 2。
- 方案 3 作为降级备份：本项目 op 模型较简单，若 JSCore 桥接成本超预期，可评估 Swift 重写 CRDT 子集 + differential 测试对拍。

## 5. 推荐落地路线（分阶段）

**P0（1–2 天，零原生代码，立即可上）**
- 扩展 options 页 + 官网增加「导出/导入 bookmarks.html」；文档写清 Safari `文件 → 导入自 → 书签 HTML 文件` / `文件 → 导出书签` 手动流程。
- 价值：验证 Safari 用户需求强度，为 P1/P2 投入提供依据；同时是所有方案共同的最后兜底。

**P1（约 2–4 周，核心 MVP：Safari 只读上行）**
- 新增 `macos-app/`（SwiftPM，可参考 BridgeMark 的单包结构）：菜单栏 App。
- 功能：邮箱 OTP 登录（supabase-swift）→ FDA 引导（检测失败时深链直达系统面板）→ FSEvents 监听 `Bookmarks.plist` → 只读把 Safari 书签推送进 Supabase（作为一台设备，deviceId/密钥入 Keychain）。
- 协议层：vite 把 `src/sync` + `src/crdt` 打成单文件 bundle，JavaScriptCore 加载；Swift 提供 fetch/crypto 桥接。
- 分发：Developer ID 签名 + 公证 + DMG；复用现有 Release workflow + Supabase `downloads` bucket（0037）模式，官网 DownloadView 增加 DMG 下载项。
- 测试：plist fixture 快照测试（多 macOS 版本样本）+ 现有 sync 测试思路迁移。

**P2（约 2–3 周，双向写入）**
- 安全写入流程（对齐 §2.3 范本）：检测 Safari 运行 → 提示退出 → 时间戳备份（保留 N 份）→ 写入 → 可选重启 Safari；iCloud 自动传播到 iPhone。
- 删除传播对齐 CRDT 收敛语义；借鉴 roanpy 处理"原生云同步回灌"（逐 target 记录漂移、云结算后再恢复）。

**P3（打磨）**
- Sparkle 自动更新；license 激活与设备数限额（0033）接入与提示；官网下载页与文档。

## 6. 风险清单

1. `Bookmarks.plist` 无官方文档，macOS 大版本可能变更 → 宽容解析 + fixture 快照测试矩阵。
2. FDA 授权体验 → 引导页 + 系统面板深链 + 运行时失败检测（BridgeMark 模式）。
3. 与 iCloud/原生同步的并发写 → 只在 Safari 退出窗口写入 + 失败重试 + 回灌防护。
4. JSCore 桥接坑：JSC 无 `fetch`/SubtleCrypto，需 URLSession/CryptoKit shim（约几百行）；降级路径为方案 3。
5. 签名成本：Apple Developer Program（$99/年）+ CI 公证 secrets（APPLE_ID / App-specific password 或 App Store Connect API key）。
6. `device_limit`（0033）会把 Mac 原生 App 计为一台设备，计费/限额文案需同步确认。
7. AGENTS.md 现有「Safari 暂缓」约束：本报告即 `feat-macos` 的立项尽调——P0 无风险可先做；P1/P2 建议以 P0 的需求信号作为投入闸门。

## 7. 参考链接

- MDN BCD bookmarks 支持矩阵：<https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/bookmarks.json>
- floccus：<https://github.com/floccusaddon/floccus> · FAQ <https://floccus.org/faq/> · Safari issue <https://github.com/floccusaddon/floccus/issues/23>
- xBrowserSync：<https://github.com/xbrowsersync/app>
- dubo78/Safari_bookmarks_Sync：<https://github.com/dubo78/Safari_bookmarks_Sync>
- roanpy/browser-bookmark-sync：<https://github.com/roanpy/browser-bookmark-sync>
- TheSawkit/BridgeMark：<https://github.com/TheSawkit/BridgeMark>
- evilmarty/safari-bookmarks-cli：<https://github.com/evilmarty/safari-bookmarks-cli>
- mickpletcher/browser-bookmark-tool：<https://github.com/mickpletcher/browser-bookmark-tool>
- jiuliwei/AppleScript 方案：<https://github.com/jiuliwei/AppleScript_to_automatically_sync_Safari_from_Chrome>
- d0dg3r/GitSyncMarks（Git 三方合并模型）：<https://github.com/d0dg3r/GitSyncMarks>
