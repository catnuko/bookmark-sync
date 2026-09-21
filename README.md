# bookmark-sync

跨浏览器书签云同步扩展（Manifest V3）。以 Supabase（Postgres + Auth）为后端，扩展直连 Supabase，无需自建服务器。支持 **Chrome / Edge / Firefox**，一套代码多端构建。

- 登录/注册复用 Supabase 官方 Auth（邮箱 + 密码），RLS 行级隔离，每个用户只能读写自己的书签。
- 同步引擎 v2：**Move-CRDT 操作日志模型**（取代旧的「快照 + 墓碑」三态合并）。书签增删改/移动转成 MoveOp（Kleppmann 树 CRDT），经 AES-256-GCM 操作级加密写入 `bsync_op_log`，多设备按 Lamport 时间戳收敛，不丢书签、不成环。
- **端到端加密默认开启**：每一条书签操作在设备上加密后才上传，服务器只见密文（快照 GC 同理）。密钥由口令派生（PBKDF2，盐存云端按用户同步）或导出/导入，新设备登录 + 输入同一口令即可解密。
- 已通过 **Chromium × Firefox × Edge 三浏览器联合验证**（`scripts/e2e/e2e-triple-sync.mjs`），含书签菜单双向同步与冷重启保留。
- 同步权威在 MV3 Service Worker：chrome.bookmarks 事件 → 本地 op 入队 → 去抖推送；popup 通过 `chrome.runtime.sendMessage` 触发同步（见 `src/background.js` / `src/sync.js`）。

## 技术栈

- 前端：Vue 3 + Vite（选项页 / 弹窗）+ MV3 service worker（后台同步引擎）
- 后端：Supabase（Postgres + Auth + RLS）
- 多浏览器：Chromium 通用 manifest + Firefox 专用 manifest 两套构建

## 目录结构

- `src/` — 扩展源码（选项页、service worker、同步引擎）；**这里才是源码真相**
- `supabase/` — 数据库迁移（`bsync_*` 表 + RPC，迁移代码已直接入库，非 submodule）
- `public/` — `manifest.json`（Chromium）；`manifest.firefox.json`（Firefox）；图标
- `extension/` — Chromium 构建产物（gitignore，勿提交）
- `extension-firefox/` — Firefox 构建产物（gitignore，勿提交）
- `scripts/` — 构建钩子与本地验证脚本
- `website/` — 官网（Vue 3 + Vite，Vercel 部署，独立工程/依赖）
- `bookmark-sync/` — Xcode Safari 壳工程（macOS/iOS），构建产物 gitignore
- `store-assets/` — 商店截图与 logo
- `docs/` — 设计文档、重构方案、手工测试计划
- `tests/` — 单元测试（vitest）
- `AGENTS.md` — 开发注意事项

## 快速开始

### 1. 初始化 Supabase

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 打开项目，进入 **SQL Editor**，按顺序执行 `supabase/migrations/` 下全部迁移（当前共 37 个，从 `0001_init.sql` 起；或用本地 `supabase db push` 一键应用）。
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

任何推送到 `dev` / `main` 或 PR 都会先跑 **Quality Gate**（`tsc` 类型检查 + eslint + vitest 单测，本地可用 `pnpm check` 一键执行），未通过不会发版。

## 已知限制

- **Safari 暂不支持**：Safari（含 iOS）不提供 `bookmarks` API，扩展侧书签同步在 Safari 上不可行，当前发布范围不包含 Safari。详见 `AGENTS.md`。
- 商店发布要求（隐私政策、AMO 源码包等）见 `AGENTS.md`。

## 许可与隐私

本扩展会收集登录邮箱与书签数据，隐私政策：https://www.bookmark-sync.top/privacy

## 更多

- 开发注意事项：见 [AGENTS.md](AGENTS.md)（构建命令、CI 发版关键点、同步协议、Safari 硬约束、协作约定）。
