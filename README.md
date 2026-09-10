# bookmark-sync

Chrome / Edge / Firefox 书签同步工具：Supabase（Postgres + Auth）作为后端，配合跨浏览器通用扩展（Manifest V3），扩展直连 Supabase 无需自建服务器。

登录/注册复用 Supabase 官方的 Auth（邮箱 + 密码 + 自动确认），不自己实现登录系统；每个用户只能读写自己的书签（RLS 行级隔离）。

## 结构

- `supabase/migrations/` — 数据库迁移脚本（`bsync_bookmarks` 表 + RLS + RPC 函数 `bsync_sync_push` / `bsync_sync_pull`，统一 `bsync_` 前缀与库内其他项目隔离）
- `src/` — 扩展源码：Vue 3 选项页（登录 / 注册 / 同步）+ 后台 service worker + 同步引擎
- `public/manifest.json` — Chromium（Chrome / Edge）扩展清单；`public/manifest.firefox.json` — Firefox 版清单（`background.scripts` + gecko id）
- `public/icons/` — 扩展图标集（16/32/48/128/256/512，manifest 引用）
- `store-assets/` — 商店提交用素材（Edge logo 等，不进扩展包）
- `extension/` — Chromium 构建产物目录，直接加载该目录即可
- `extension-firefox/` — Firefox 构建产物目录（`pnpm build:firefox` 生成）

## 部署

### 1. 初始化 Supabase

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 打开项目，进入 **SQL Editor**，执行 `supabase/migrations/0001_init.sql`。
2. 开启注册即用：**Authentication → Providers → Email → 关闭「Confirm email」**（否则注册后需邮件验证）。
3. 把 `src/lib/supabase.js` 里的 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 改成你自己项目的值。

### 2. 构建扩展

```bash
pnpm install
pnpm build            # Chrome / Edge 产物 -> extension/（macOS 上还会同步并编译 Safari 工程）
pnpm build:firefox    # Firefox 产物 -> extension-firefox/
```

`pnpm dev` 可本地预览选项页界面（不带扩展 API 也能看 UI）。

### 3. 加载扩展

- Chrome：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选择 `extension/` → 打开扩展选项页登录后即可同步。
- Edge：`edge://extensions` → 开发人员模式 → 加载解压缩的扩展 → 选择 `extension/`（Edge 原生兼容 Chrome MV3 扩展）。
- Firefox：`about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选择 `extension-firefox/manifest.json`（临时加载不需要签名；正式分发请用 `web-ext sign` 或上传 AMO 获取签名 XPI）。
- Safari：`xcrun safari-web-extension-converter extension/ --project-location /Users/qiuzhenyu/Documents/projects/bookmark-sync/extension --app-name BookmarkSync`，用 Xcode 编译运行后在 Safari 中启用。注意：Safari 不支持 `bookmarks` API，Safari 侧无法进行书签同步。

## 商店发布检查清单

本扩展收集邮箱与书签数据，三家商店均要求提供公开隐私政策 URL（https://bookmarksync.app/privacy）并如实申报数据用途。以下为按商店整理的发布要求与项目现状。

### 共性要求（均已满足）

- 隐私政策 URL：`https://bookmarksync.app/privacy`（已覆盖收集/存储/使用/第三方分享/删除/联系方式，与扩展实际行为一致）
- 单一用途：描述即「跨浏览器书签云同步」，功能不越界
- 最小权限：仅 `bookmarks`（读写书签）+ `storage`（保存会话/同步状态）+ `https://*.supabase.co/*`（与后端通信），无 `tabs`/`<all_urls>`
- 无远程代码：逻辑全部随包分发，MV3 CSP 合规
- 图标：`public/icons/` 提供 16/32/48/128（商店列表图标 128×128）

### Chrome Web Store

- 开发者注册费 $5 一次性 + Google 账号开启两步验证（硬性）
- 提交 `extension/` 打包的 zip（manifest 位于根目录）
- 列表页必填：图标 128×128、截图 ≥1 张（1280×800 或 640×400，最多 5 张）、类别、语言
- 隐私权规范必填：勾选收集的数据（邮箱、书签），逐项填写 `bookmarks` / `storage` / `*.supabase.co` 的用途，与隐私政策一致
- 审核约数天～数周，更新走同样流程

### Firefox Add-ons（AMO，注册免费）

- **`data_collection_permissions`**：2025-11-03 起 AMO 校验必填，已在 `manifest.firefox.json` 声明 `authenticationInfo`（邮箱登录）/ `bookmarksInfo`（书签同步）/ `personallyIdentifyingInfo`（邮箱 PII）；安装时 Firefox 展示内建数据收集同意弹窗
- 列表页：名称 ≤50 字符、摘要 ≤250 字符、详细描述（AMO 渲染 HTML，须写明**传输哪些数据**，以及 Pro/Lifetime 付费为可选的 Creem 买断）、支持邮箱/网站、许可证
- **源码提交**：产物为压缩 bundle，AMO 要求提交源码包（zip 打包 `src/` + `package.json` 即可）
- 首次人工审核约 1～2 周；`gecko.id` 一经提交不可更改

### Microsoft Edge Add-ons（Partner Center，注册免费）

- 提交 `extension/` 的 zip；认证测试需提供测试说明（如登录账号）
- 隐私政策 URL 必填（收集个人信息时），并逐项申报数据用途
- 视觉素材：logo（1:1，建议 300×300、最小 128×128，已生成 `store-assets/edge-logo-300x300.png`）、可选 440×280 促销磁贴、截图 1280×800 / 640×400（最多 10 张）

## 说明

- 数据隔离：`bsync_bookmarks` 启用 RLS，策略为 `auth.uid() = user_id`；`bsync_sync_push` / `bsync_sync_pull` 使用 `security invoker`，RPC 经登录用户 JWT 调用，按用户天然隔离。
- 会话：登录态存于 `chrome.storage.local`，选项页与后台 service worker 共享，令牌过期自动刷新。
- 同步协议：快照 diff + 单调递增版本号增量拉取 + 服务端按 URL 去重。

### 从旧「密钥」方案迁移

本版本改为 Supabase Auth。迁移脚本会清理旧的 `bsync_sync_secret` 表与带 token 参数的旧函数；旧密钥写入的书签没有 `user_id`，会被 RLS 忽略，请登录后重新同步。