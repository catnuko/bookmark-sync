# bookmark-sync

跨浏览器书签云同步扩展（Manifest V3）。以 Supabase（Postgres + Auth）为后端，扩展直连 Supabase，无需自建服务器。支持 **Chrome / Edge / Firefox**，一套代码多端构建。

- 登录/注册复用 Supabase 官方 Auth（邮箱 + 密码），RLS 行级隔离，每个用户只能读写自己的书签。
- 同步采用「快照 + 墓碑」协议，支持多设备新增/删除收敛（内部实现见代码，协议细节与验证在 `scripts/verify-sync-local/`）。

## 技术栈

- 前端：Vue 3 + Vite（选项页 / 弹窗）+ MV3 service worker（后台同步引擎）
- 后端：Supabase（Postgres + Auth + RLS）
- 多浏览器：Chromium 通用 manifest + Firefox 专用 manifest 两套构建

## 目录结构

- `src/` — 扩展源码（选项页、service worker、同步引擎）；**这里才是源码真相**
- `supabase/migrations/` — 数据库迁移（`bsync_*` 表 + RPC，统一 `bsync_` 前缀）
- `public/` — `manifest.json`（Chromium）；`manifest.firefox.json`（Firefox）；图标
- `extension/` — Chromium 构建产物（gitignore，勿提交）
- `extension-firefox/` — Firefox 构建产物（gitignore，勿提交）
- `scripts/` — 构建钩子与本地验证脚本
- `website/` — 官网（Vue 3 + Vite，Vercel 部署，独立工程/依赖）
- `Agent.md` — 开发注意事项（构建命令、CI 关键点、Safari 限制等）

## 快速开始

### 1. 初始化 Supabase

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 打开项目，进入 **SQL Editor**，按顺序执行 `supabase/migrations/0001_init.sql` ～ `0007_pull_latest_by_id.sql`（或本地 `supabase db push`）。
2. 开启注册即用：**Authentication → Providers → Email → 关闭「Confirm email」**。
3. 把 `src/lib/supabase.js` 里的 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 改成你自己项目的值。

### 2. 构建

```bash
pnpm install
npx vite build        # Chrome / Edge -> extension/
node scripts/build-firefox.mjs   # Firefox  -> extension-firefox/
```

> 说明：也可用 `pnpm build`（含 Safari 同步）与 `pnpm build:firefox`，但 CI 发版只用上面的裸命令，避免触发 Xcode 编译。`pnpm dev` 可本地预览选项页 UI。

### 3. 在浏览器中加载

- Chrome：`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `extension/`。
- Edge：`edge://extensions` → 开发人员模式 → 加载解压缩 → 选 `extension/`。
- Firefox：`about:debugging#/runtime/this-firefox` → 「临时载入附加组件」→ 选 `extension-firefox/manifest.json`（正式分发需 AMO 签名）。

加载后打开扩展选项页，登录账号即可同步。

## 发布（CI 自动发版）

推送 `feat:`/`fix:` 提交（Conventional Commits）到 `main` 后，GitHub Actions 自动完成：升级版本号 → 生成 `CHANGELOG.md` → 开 release PR → 合并后打 tag 并发布，产出**两个 zip** 挂到 Release：

- `bookmark-sync-chromium-<ver>.zip`（Chrome / Edge）
- `bookmark-sync-firefox-<ver>.zip`（Firefox）

## 已知限制

- **Safari 暂不支持**：Safari（含 iOS）不提供 `bookmarks` API，扩展侧书签同步在 Safari 上不可行，当前发布范围不包含 Safari。详见 `Agent.md`。
- 商店发布要求（隐私政策、AMO 源码包等）见 `Agent.md`。

## 许可与隐私

本扩展会收集登录邮箱与书签数据，隐私政策：https://bookmarksync.app/privacy

## 更多

- 开发注意事项：见 [Agent.md](Agent.md)（构建命令、CI 发版关键点、同步协议、Safari 硬约束、协作约定）。