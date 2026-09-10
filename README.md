# bookmark-sync

Chrome 与 Safari 书签同步工具：Supabase（Postgres + Auth）作为后端，配合双端通用浏览器扩展（Manifest V3），扩展直连 Supabase 无需自建服务器。

登录/注册复用 Supabase 官方的 Auth（邮箱 + 密码 + 自动确认），不自己实现登录系统；每个用户只能读写自己的书签（RLS 行级隔离）。

## 结构

- `supabase/migrations/` — 数据库迁移脚本（`bsync_bookmarks` 表 + RLS + RPC 函数 `bsync_sync_push` / `bsync_sync_pull`，统一 `bsync_` 前缀与库内其他项目隔离）
- `src/` — 扩展源码：Vue 3 选项页（登录 / 注册 / 同步）+ 后台 service worker + 同步引擎
- `public/manifest.json` — 扩展清单
- `extension/` — 构建产物目录，直接加载该目录即可

## 部署

### 1. 初始化 Supabase

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 打开项目，进入 **SQL Editor**，执行 `supabase/migrations/0001_init.sql`。
2. 开启注册即用：**Authentication → Providers → Email → 关闭「Confirm email」**（否则注册后需邮件验证）。
3. 把 `src/lib/supabase.js` 里的 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 改成你自己项目的值。

### 2. 构建扩展

```bash
pnpm install
pnpm build
```

`pnpm dev` 可本地预览选项页界面（不带扩展 API 也能看 UI）。

### 3. 加载扩展

- Chrome：`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 选择 `extension/` → 打开扩展选项页登录后即可同步。
- Safari：`xcrun safari-web-extension-converter extension/ --project-location /Users/qiuzhenyu/Documents/projects/bookmark-sync/extension --app-name BookmarkSync`，用 Xcode 编译运行后在 Safari 中启用。

## 说明

- 数据隔离：`bsync_bookmarks` 启用 RLS，策略为 `auth.uid() = user_id`；`bsync_sync_push` / `bsync_sync_pull` 使用 `security invoker`，RPC 经登录用户 JWT 调用，按用户天然隔离。
- 会话：登录态存于 `chrome.storage.local`，选项页与后台 service worker 共享，令牌过期自动刷新。
- 同步协议：快照 diff + 单调递增版本号增量拉取 + 服务端按 URL 去重。

### 从旧「密钥」方案迁移

本版本改为 Supabase Auth。迁移脚本会清理旧的 `bsync_sync_secret` 表与带 token 参数的旧函数；旧密钥写入的书签没有 `user_id`，会被 RLS 忽略，请登录后重新同步。