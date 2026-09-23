# Supabase 管理规则

本地代码驱动，远端只通过 Supabase CLI / CI 部署。**MCP 只读，CLI 写远端；迁移文件和函数源码是唯一真实来源。**

## Supabase 目录（已内联）

- `supabase/` 是本仓库的普通目录，承载 Supabase 项目的迁移、边缘函数与配置，**直接改、直接提交**（2026-09-19 起由中央仓库 + submodule 内联而来，旧仓库 catnuko/supabase-snaply-multi 已归档，历史随 subtree 合并保留在本仓库）。
- **仓库规范见 `supabase/TENANTS.md`**（含命名占用、迁移编号推导规则、10 条规范，其中 RLS 变更必须配 role-play 测试）。
- 部署命令在 `supabase/` 目录下执行：`supabase db push` / `supabase functions deploy <name>`。

## 唯一写路径

- 数据库：`supabase/migrations/*.sql`
- 边缘函数：`supabase/functions/<name>/index.ts`
- 部署命令：`supabase db push` / `supabase functions deploy <name>`

## 禁止

- 禁止用 MCP / Dashboard SQL 编辑器直接修改远端结构。
- 禁止跳过迁移文件直接执行 DDL。
- 禁止修改已提交的历史迁移（只新增迁移，不回头改 0001~0007）。

## 变更流程

- 数据库：`supabase migration new <name>` → 编辑 SQL → `supabase db push`（直连远端，无需本地数据库/Docker）。
- 边缘函数：编辑 `supabase/functions/<name>/index.ts` → `supabase functions deploy <name>`。
- secrets 不写入代码，用 `supabase secrets set` 或 CI secrets 管理。
- 每次变更后更新本地文件并提交 Git。需要远端写操作时，先给出迁移文件、函数代码或命令，等用户审查后再执行。

## ★ 表授权（2026-10-30 起强制）

Supabase 自 2026-10-30 起停止对 public schema 的**新建**表/序列自动授予 Data API 权限（changelog #45329）。**存量表保留授权，生产不受影响**；风险在「全量重放」场景（`supabase db reset`、preview branch、新项目、灾备重建）——那会得到 Data API 全不可见的库。

- **任何 `create table public.*` 的迁移必须在同一文件里写全 `grant`**，序列另需 `grant usage on sequence`。角色按需：`anon`（仅公开表单）、`authenticated`（一般只 `select`，写入走 SECURITY DEFINER RPC）、`service_role`（边缘函数直连）。
- **禁止** `alter default privileges ... grant` 自救（对所有未来表开放全量 DML，废掉 0032 的收权）；**禁止** `DROP TABLE + CREATE TABLE` 式迁移（0017 这么做时把在用的 grant 全抹了）。
- 存量表授权基线：`supabase/migrations/0040_explicit_data_api_grants.sql`。完整规范见 `supabase/TENANTS.md` 第 11 条。

## 本地环境（无 Docker / 无本地 PostgreSQL）

- 沙箱环境无法运行 Docker（无 iptables / 无 KVM），且不安装本地 PostgreSQL。
- 读远端 schema：用 `introspect.js`（Node pg 直连，走 socat 隧道），不要把远端结构写入本地数据库。
- 本地验证迁移：可选方案为 Node 嵌入式 Postgres（如 `embedded-postgres` 包，轻量、随项目临时起停）；默认不安装。

## MCP 边界

- 允许：只读查询（SELECT）、列 schema、看日志（list_tables / get_logs 等）。
- 禁止：`apply_migration`、`create_table`、`deploy_edge_function`、任何写 SQL。

## 基线

- 远端现状已通过 `functions download` + introspect 脚本（Node pg 直连，沙箱无 Docker 故未用 `db pull`）同步到本地（见 baseline 提交）。
- 基线化补齐了远端绕过迁移直接创建的对象：0008（License/Token 计费系统 7 表 + 8 函数）、0009（废弃 bsync_bookmarks）。
- 后续远端漂移必须先同步为迁移文件，再继续开发。

---

# 项目开发注意事项（原 Agent.md — bookmark-sync）

给后续开发/维护的 agent 看的要点。**源目录即真相**（`src/`），构建产物目录（`extension/`、`extension-firefox/`）都在 `.gitignore`，不要直接改，也不要提交。

## 1. 构建与产物（三浏览器，Safari 暂不做）

- Chrome / Edge：同一份产物。`npx vite build` → `extension/`（同时拷入 `public/manifest.json`），manifest 在 zip 根目录。
- Firefox：`node scripts/build-firefox.mjs` = 拷贝 `extension/` → `extension-firefox/` 并**替换成 `public/manifest.firefox.json`**（`background.scripts` + `options_ui` + `browser_specific_settings.gecko.id`）。
- 注意：`pnpm build` = `vite build && node scripts/post-build-safari.mjs`，会顺带同步并尝试编译 Xcode Safari 工程 —— **CI 里不要用 `pnpm build`**，要分别跑 `npx vite build` + `node scripts/build-firefox.mjs`。
- 每个 Release 产出两个 zip：`bookmark-sync-chromium-<ver>.zip`、`bookmark-sync-firefox-<ver>.zip`。

## 2. 发版流程（全自动，dev → main，无需人工介入）

**开发流程：所有改动走 `dev` 分支，用 Conventional Commits 提交；合并到 `main` 即全自动发版，全程无人操作（release PR 自动合并，不做人工合并）。**

### 全自动闭环（`.github/workflows/release.yml`）

1. push / 合并到 main → release-please 按约定式提交计算下一版本
2. release-please 自动更新 `package.json` + `CHANGELOG.md` + manifest 版本（extra-files），并开 release PR
3. workflow 的 **Auto-merge** 步骤自动合并该 PR（`gh pr merge --merge`）
4. 合并触发新 run → release-please 自动打 tag + 创建 GitHub Release
5. build job 构建并上传 `bookmark-sync-chromium-<ver>.zip` / `bookmark-sync-firefox-<ver>.zip`

### 版本管理文件（勿手动改版本号发版）

- `release-please-config.json`：extra-files 让 release PR 同步 `public/manifest.json`、`public/manifest.firefox.json` 的 `version` 字段
- `.release-please-manifest.json`：版本基线（当前 2.1.0）
- **禁止**手动改 package.json 版本号或手动打 tag / 建 Release——会绕过 release-please 导致版本错乱（v2.0.0 就是这么出的岔子：release PR 悬挂、manifest 版本滞后）

### 要点（踩过的坑，勿回退）

- `permissions` 必须 `contents: write` + **`pull-requests: write`**，否则 release-please 建 PR 报 "Resource not accessible by integration"。
- 仓库设置需开启 **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**。
- `pnpm/action-setup@v4` 必须给 `version: 10`，否则报 "No pnpm version is specified"。
- 不用 `pnpm build`（会顺带跑 Safari 的 Xcode 同步/编译），CI 里分别跑 `npx vite build` + `node scripts/build-firefox.mjs`。
- **Auto-merge 必须用 `--merge`（merge commit）**：release-please 靠 merge commit message 识别发布。
- **release-please-action v4 输出语义（踩坑两次，v2.3.0/2.3.1 实测）**：`pr`/`prs` 仅在「release 已创建」的轮次有值，创建 release PR 的轮次是 unset；根组件的 `release_created` 无 release 时也是 unset 而非 `'false'`。auto-merge 条件必须写 `releases_created != 'true' && prs_created == 'true'`（`releases_created` 文档保证无 release 时为 'false'）。
- **extra-files(json) 实测不生效**（PR #9/#13/#14 均未触碰 manifest）：release.yml 在 build job 里于 vite build 前按 package.json 版本回填两个 manifest，保证发出去的 zip 版本号正确；仓库内 manifest 版本号在每次 main→dev 回带时手动补齐（当前 2.3.1）。
- release-please 按 Conventional Commits 定版本：`fix:` → patch，`feat:` → minor，`BREAKING CHANGE` → major。**提交不带前缀不会触发版本升级**；`chore:` 适合 CI/配置/文档改动，不 bump。
- **dev→main 合并不要 squash**，避免折叠掉 Conventional 前缀导致版本判断失效。
- `gh` CLI 用 `GH_TOKEN` 登录（git push 需先 `gh auth setup-git`），但该 token 无 workflow dispatch 权限，触发工作流用 push 事件即可。
- 私有仓库：匿名 curl 下载 release asset 返回 404，须用 `gh release download <tag> --repo catnuko/bookmark-sync`。
- **官网安装包分发**（2026-09-19 起）：Release 资产仍是权威产物；release.yml 随后把两个 zip + `latest.json` 上传到 Supabase Storage public bucket `downloads`（桶由迁移 0037 创建，写路径仅 service_role）。官网 DownloadView 运行时读 `latest.json` 生成下载链接，**发新版官网无需重新部署**；`website/public/downloads/` 已 gitignore，仓库不存 zip 二进制。需要 secret：`SUPABASE_SERVICE_ROLE_KEY`。

## 3. ★ Safari 硬约束（暂缓，勿投入）

- Safari（macOS + iOS）**不支持 `bookmarks` API**（Apple 2011 移除、2020 未实现，至今不支持），项目同步逻辑无降级分支 → 在 Safari 上「立即同步」必失败。macOS blocked 只能靠原生 App 直读写 `~/Library/Safari/Bookmarks.plist`（需关 App Sandbox + 完全磁盘访问，无法上 Mac App Store）；iOS 只能经 iCloud 中转（手机不够，Safari 书签不可读）。
- 因此**当前发布范围仅 Chrome / Edge / Firefox，Safari 不参与**。

## 4. 同步协议（快照 + 墓碑，并集合并）

- 新增 = 并集（任一设备有而服务端没有的都保留）；删除 = 墓碑传播（粘性删除，不复活）；重加 = 原删除设备获胜（墓碑带持久随机 `deviceId`）。
- 迁移脚本须按 `0001 → 0007` 顺序执行（`0005_tombstones.sql` 开头 drop 旧签名重写 RPC）。
- 本地验证：`scripts/verify-sync-local/`（setup.sql + scenario.sql），psql 退出码 3 = 最后「未登录应报错」的预期错误触发 ON_ERROR_STOP，**不是失败**。
- 数据强调 RLS 行级隔离，登录态存 `chrome.storage.local`。

## 5. 商店发布注意

- 三家商店都要求公开隐私政策 URL（`https://www.bookmark-sync.top/privacy`）。
- AMO：`manifest.firefox.json` 已声明 `data_collection_permissions`（邮箱/书签/PII）；审核要交**源码包**（打包 `src/`+`package.json`），产物是压缩 bundle；`gecko.id` 一经提交不可改。
- Chrome/Edge 提交 `extension/` 的 zip。

## 6. 与用户协作约定

- 改代码前先对齐方案，不自动 commit/push（需明确授权）。
- 视觉验证以截图对照参考实现为准。
- 本文件是开发注意事项，README 才是面向部署/发布的完整说明。
