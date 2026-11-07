# bookmark-sync

**跨浏览器书签云同步扩展（Manifest V3）。** 以 Supabase（Postgres + Auth）为后端，扩展直连 Supabase，无需自建服务器。一套代码多端构建：**Chrome / Edge / Firefox**。

[English](README.md) | 简体中文

## 功能特性

- **端到端加密默认开启。** 每一条书签操作在设备上加密（AES-256-GCM）后才上传，服务器只见密文。密钥由口令派生（PBKDF2，盐按用户存云端）或导出/导入；新设备登录后输入同一口令即可解密。
- **同步引擎 v2 —— Move-CRDT 操作日志。** 书签增删改/移动转成 MoveOp（Kleppmann 树 CRDT），加密后追加写入 `bsync_op_log`，多设备按 Lamport 时间戳收敛：不丢书签、不成环、没有要人工处理的合并冲突。
- **认证开箱即用。** 邮箱 + 密码复用 Supabase Auth，RLS 行级隔离，每个用户只能读写自己的数据。
- **商店级发布链路。** release-please + GitHub Actions 自动产出 Chromium、Firefox 商店 zip 与 AMO 审核用源码包。

## 浏览器支持

| 浏览器 | 状态 | 安装 |
| --- | --- | --- |
| Chrome / Edge | 支持 | [Chrome 应用商店](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml)（Edge 可直接装；另有 [Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah)独立上架） |
| Firefox | 支持 | [Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/bookmark-sync-app) |
| Safari（macOS / iOS） | **不支持** | Safari 不提供 `bookmarks` API，扩展侧书签同步在 Safari 上当前不可行 |

## 同步原理

同步权威在 MV3 Service Worker：`chrome.bookmarks` 事件 → 本地 op 入队 → 去抖推送；popup 通过 `chrome.runtime.sendMessage` 触发同步（见 `src/background.ts` / `src/sync/`）。同步引擎、CRDT 与加密层都在 `src/` —— 该目录才是源码真相。

## 自托管

可以完全跑在自己的 Supabase 项目上：建库迁移、可选部署的计费 edge function、扩展端如何注入自己的端点，见 [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)。自托管实例**不使用**托管服务的 Creem 订阅计费；额度通过 `quota_bytes` 字段自行配置。

## 价格（托管服务）

托管服务（本仓库默认的 Supabase 项目）免费档为每账号 **1,000 条 / 5 MiB**，更高额度提供付费档（Plus / Pro / Lifetime）。自托管则由你自己决定额度。细节可能调整，扩展内始终展示你当前的档位与用量。

## 开发

```bash
pnpm install
pnpm dev            # 本地预览选项页 / 弹窗 UI
pnpm build          # Chromium 构建 -> extension/（含 Safari 壳后置步骤）
pnpm build:firefox  # Firefox 构建 -> extension-firefox/
pnpm check          # 类型检查 + lint + 格式检查 + 单测
pnpm test           # vitest 单元测试
```

- `src/` —— 扩展源码（选项页、弹窗、Service Worker、同步引擎）；**源码真相**
- `supabase/` —— 数据库迁移（`bsync_*` 表 + RPC），迁移代码直接入库
- `scripts/` —— 构建钩子、打包与本地验证脚本（含 `scripts/e2e/` 三浏览器 E2E）
- `website/` —— 官网（Vue 3 + Vite，Vercel 部署，独立依赖树）
- `docs/` —— 设计文档、自托管与隐私文档

浏览器中加载构建产物：

- Chrome：`chrome://extensions` → 开发者模式 → 加载已解压 → `extension/`
- Edge：`edge://extensions` → 加载解压缩 → `extension/`
- Firefox：`about:debugging#/runtime/this-firefox` → 临时载入附加组件 → `extension-firefox/manifest.json`（正式分发需 AMO 签名）

发版自动化：Conventional Commits 推送到 `main` 后经 release-please 流程，合并 release PR 即升版本、打 tag 并在 GitHub Release 挂三个 zip（chromium / firefox / source）。发版前有质量门禁（typecheck + lint + 格式 + 单测）。

## 参与

欢迎贡献！请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。要点：提交需带 `Signed-off-by`（`git commit -s`，[DCO](https://developercertificate.org/)），提交信息遵循 Conventional Commits。

## 隐私

服务器能看见什么、看不见什么，错误上报如何工作，见 [docs/PRIVACY.md](docs/PRIVACY.md) 与官网隐私政策（https://www.bookmark-sync.top/privacy）。

## 安全

发现漏洞请**不要开公开 issue**，私密上报渠道见 [SECURITY.md](SECURITY.md)。

## 许可证

本项目以 [GNU Affero 通用公共许可证 v3.0 或更新版本](LICENSE)（AGPL-3.0-or-later）开源，覆盖扩展、Supabase 后端（迁移 + edge functions）、官网与仓库内全部脚本。
