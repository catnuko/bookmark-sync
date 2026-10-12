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
- 每个 Release 产出三个 zip：`bookmark-sync-chromium-<ver>.zip`、`bookmark-sync-firefox-<ver>.zip`、`bookmark-sync-source-<ver>.zip`（AMO 源码包，见第 5 节）。
- 打包脚本（本地 `pnpm package` 与 CI 走**同一条路径**，产物都落 `dist/`）：
  - `scripts/package-zips.mjs [ver]` → chromium / firefox 两个扩展包，manifest 在 zip 根目录；
  - `scripts/package-source.mjs [ver]` → AMO 源码包（可复现构建的最小源码集 + 自动生成的 `BUILD.md`）；
  - 二者共用 `scripts/lib/zip.mjs`（无依赖 zip 写入器，不依赖 runner 的 `zip` 命令）。版本号缺省取 `package.json`，CI 显式传 `resolve` job 定下的版本。
- 定价封面图（Creem 产品用，**不参与发版**）：`pnpm pricing-cover` → `scripts/make-pricing-cover.mjs`，渲染官网 `/pricing` 的英文版截 `.pricing-hero`，产出 `dist/creem-pricing-cover-{plus,pro}.png`（3840×2000）。Plus 版带「Recommended」徽标，Pro 版去掉 —— 免得在 Pro 产品页反向推销更便宜的 Plus。
  走 Playwright + **系统 Chrome**（`channel: 'chrome'`；本机没装 Playwright 自带的 chromium，`CHROME_BIN` 可覆盖）。**别用 Safari MCP 截图**：它回传 base64、落不了盘，而 Creem 上传要磁盘上的文件。

## 2. 发版流程（全自动，dev → main；唯一人工动作 = 手动触发商店提交）

**开发流程：所有改动走 `dev` 分支，用 Conventional Commits 提交；合并到 `main` 即全自动发版（release PR 自动合并，不做人工合并）。** 2026-09-29 发 v2.5.2 已实测跑通全程零人工介入；2026-09-29 起追加「商店自动提交」，但提交动作拆到独立工作流，需人工在 Actions 页面点一次 Run workflow 放行（见第 5 节）。

### 全自动闭环（`.github/workflows/release.yml`）

1. push / 合并到 main → release-please 按约定式提交计算下一版本
2. release-please 自动更新 `package.json` + `CHANGELOG.md` + manifest 版本（extra-files），并开 release PR
3. workflow 的 **Auto-merge** 步骤自动合并该 PR（`gh pr merge --merge`）
4. ★ **合并动作本身不会触发下一轮**：`GITHUB_TOKEN` 引发的事件被 GitHub 递归抑制，合并产生的 push 事件不创建新 run，tag 就建不出来（2026-09-28 发 2.5.1 实测）。**由工作流自己解决**：Auto-merge 之后紧接一步 `gh workflow run release.yml --ref main`（`workflow_dispatch` 是这条递归规则的例外），**不需要人工踢**。第二轮 release-please 才打 tag + 创建 GitHub Release。
5. **`resolve` job** 统一算「这次构建哪个 tag / 哪个版本」：正常发版取 release-please 的输出，手动补发取 `workflow_dispatch` 的 `tag` 输入；`build` 只依赖它 —— 这样 tag 建好之后若质量门/打包/上传失败，**还能按 tag 重跑 build**（否则 build 会因 `release_created` 已 unset 而永久跳过）。
6. build job 构建并上传三个 zip：`bookmark-sync-chromium-<ver>.zip` / `bookmark-sync-firefox-<ver>.zip` / `bookmark-sync-source-<ver>.zip`（最后一个只挂 Release，不进官网）
7. ★ **商店提交不在 `release.yml` 里**，见独立工作流 `.github/workflows/publish-stores.yml`：手动 `workflow_dispatch` 触发，从 GitHub Release 取回三个 zip 提交到 Chrome Web Store / Edge Add-ons / Firefox AMO。**这是全流程唯一的人工动作** —— 到 Actions 页面点一次「Run workflow」（tag 留空 = 取最新 Release）。商店提交失败**不影响** `release.yml` 已发布的一切（Release / tag / 官网下载在 build 阶段就发布完了）。

### 版本管理文件（勿手动改版本号发版）

- `release-please-config.json`：根包 `"."` 的 **`exclude-paths`** 决定哪些路径的提交不参与版本判定 —— 非扩展产物（`website` / `docs` / `memory` / `extension-infomation` / `supabase` / `tests` / `.github` / `bookmark-sync`）一律排除，**版本号只随扩展产物（`src/`、`public/`、`scripts/`、`package.json`、`vite.config.js` 等）变化**。语义：某提交的**全部**改动文件都落在排除路径下才排除（混合提交仍 bump）；只做**目录前缀**匹配，写文件路径（如 `AGENTS.md`）无效。**新增顶层目录时，若不属于扩展产物，要加进这个列表**（护栏：`tests/release-please-config.test.ts`）。另：`extra-files` 本意是让 release PR 同步两个 manifest 的 `version`，但**实测不生效**（见下「要点」）。
- `.release-please-manifest.json`：版本基线（release-please 自动维护，勿手改）
- **禁止**手动改 package.json 版本号或手动打 tag / 建 Release——会绕过 release-please 导致版本错乱（v2.0.0 就是这么出的岔子：release PR 悬挂、manifest 版本滞后）。**同理禁止代用户合 release PR、禁止本地手工打包上传**：发版链路上的问题一律「修好流水线」而不是绕过它。

### 要点（踩过的坑，勿回退）

- `permissions` 必须 `contents: write` + **`pull-requests: write`**，否则 release-please 建 PR 报 "Resource not accessible by integration"。
- 仓库设置需开启 **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**。
- `pnpm/action-setup@v4` 必须给 `version: 10`，否则报 "No pnpm version is specified"。
- 不用 `pnpm build`（会顺带跑 Safari 的 Xcode 同步/编译），CI 里分别跑 `npx vite build` + `node scripts/build-firefox.mjs`。
- **Auto-merge 必须用 `--merge`（merge commit）**：release-please 靠 merge commit message 识别发布。
- **release-please-action v4 输出语义（踩坑两次，v2.3.0/2.3.1 实测）**：`pr`/`prs` 仅在「release 已创建」的轮次有值，创建 release PR 的轮次是 unset；根组件的 `release_created` 无 release 时也是 unset 而非 `'false'`。auto-merge 条件必须写 `releases_created != 'true' && prs_created == 'true'`（`releases_created` 文档保证无 release 时为 'false'）。
- **extra-files(json) 实测不生效**（PR #9/#13/#14 均未触碰 manifest）：release.yml 在 build job 里于 vite build 前按 package.json 版本回填两个 manifest，**发出去的 zip 版本号恒正确**；仓库内这两个文件的版本号会漂移（2026-09-29 时是 2.5.0 而 package.json 已是 2.5.2），按惯例在 main→dev 回带时顺手补齐，它不参与发版判定。
- release-please 按 Conventional Commits 定版本：`fix:` → patch，`feat:` → minor，`BREAKING CHANGE` → major。**提交不带前缀不会触发版本升级**；`chore:` 适合 CI/配置/文档改动，不 bump。
- **dev→main 合并不要 squash**，避免折叠掉 Conventional 前缀导致版本判断失效。
- `gh` CLI 用 `GH_TOKEN` 登录（git push 需先 `gh auth setup-git`）。本地 token **可以** `gh workflow run`（2026-09-28 实测，此前「无 workflow dispatch 权限」的说法不成立）—— 用途仅限于下面的「重跑自动化」。
- **发版卡住时只「重跑自动化」，这不是手动发版**（三条命令都不碰版本号 / tag / Release，2026-09-29 已实测）：①「release PR 合了但没 tag」→ `gh workflow run release.yml --ref main`；②「tag/Release 建好了但 zip 没上传」（build 或质量门失败）→ `gh workflow run release.yml --ref main -f tag=vX.Y.Z`，resolve job 按该 tag 只重跑 build，GitHub Release 用 `--clobber`、Supabase 用 `x-upsert`，幂等可重复；③「商店没提交成功」（凭证错/过期、商店系统抖动）→ 先修 `stores` environment 的凭证，再重跑商店提交 `gh workflow run publish-stores.yml --ref main -f tag=vX.Y.Z`（等价于在 Actions 页面点 Run workflow），只提交商店，不重跑打包、不重建 tag。**三条都救不回来 → 修 workflow 并走 dev→main。**
- **商店提交是独立工作流、默认不自动跑**：`release.yml` 完全不碰商店；`publish-stores.yml` 只有人工 `workflow_dispatch` 一个入口。**同一版本重复提交会被三家商店以「版本号未递增」拒绝**，所以绝不要在 `release.yml` 里加「自动调用 publish-stores」的步骤。
- **★ 私有仓库 + Free 套餐不支持 environment 保护规则**（2026-09-29 实测）：`Required reviewers` / `Wait timer` 都返回 422「Please ensure the billing plan supports ... protection rule」；`Environment secrets/variables` 和 `Deployment branches` 限制**仍然可用**。这就是商店提交必须走独立工作流手动触发、而不是在流水线中途暂停等 Approve 的原因。升级到 GitHub Pro 后可改回「挂 `environment: stores` + Required reviewers」的一键 Approve 模式。
- **★ release PR 上的 `Quality Gate` 必红，是预期现象、不是故障**（2026-09-30 排查定论）：release-please 用 `GITHUB_TOKEN` 建 PR，而 GitHub 对「bot 建的 PR」的 `pull_request` 事件**会创建 run 但不放行**（run 页注解原文：_"This workflow run required approval but was not approved before it expired."_）。没人点批准 → Auto-merge 一合并，这个悬挂的 run 立即作废并被记成 `failure`。识别特征：**0 个 job、生命周期 ≈ PR 存活时长**（run 的 `updated_at` = PR 的 `merged_at` +1~2s；`gh run view` 会误报 "workflow file issue"，那是 gh 对 0-job run 的兜底话术）。2026-09-22 起 8/8 次发版全如此，人开的 PR 则正常跑绿（`actor` = `github-actions[bot]` 是判别点）。**不阻断发版**：无 branch protection，auto-merge 用 `gh pr merge` 不等检查，同一棵树由 `push: main` 那轮真跑。
  - **隐患**：升 GitHub Pro 后若给 main 开 branch protection 并把 `Quality Gate` 设为必需检查，**release PR 会永久卡死**（永远等不到批准）。届时二选一：① `ci.yml` 的 `pull_request:` 下加 `paths-ignore`（列 release PR 恰好只改的那三个文件：`CHANGELOG.md` / `.release-please-manifest.json` / `package.json`）→ 干脆不创建 run；副作用是「只改 package.json」的 PR 会漏跑 CI。② 给 release-please 传非 `GITHUB_TOKEN` 的 `token:`（PAT / GitHub App）→ PR 检查才真正执行。
- 私有仓库：匿名 curl 下载 release asset 返回 404，须用 `gh release download <tag> --repo catnuko/bookmark-sync`。
- **官网安装包分发**（2026-09-19 起）：Release 资产仍是权威产物；release.yml 随后把两个 zip + `latest.json` 上传到 Supabase Storage public bucket `downloads`（桶由迁移 0037 创建，写路径仅 service_role）。官网 DownloadView 运行时读 `latest.json` 生成下载链接，**发新版官网无需重新部署**；`website/public/downloads/` 已 gitignore，仓库不存 zip 二进制。需要 secret：`SUPABASE_SERVICE_ROLE_KEY`。**源码包不进 Supabase**（官网访客不需要源码），只挂 Release。
- **★ 官网并列显示两个版本号**（2026-09-30 起）：`latest.json` = **我们已发布**的版本；`stores.json` = **商店在架**的版本。二者语义不同、刻意分成两个文件 —— 商店审核有延迟，在架版本常落后于我们已发布的版本，只显示其中一个会让用户点进商店后看到不一致的版本号。`stores.json` 由独立工作流 `.github/workflows/store-versions.yml`（cron `0 */6 * * *` + `workflow_dispatch`，`environment: stores`）跑 `scripts/fetch-store-versions.mjs` 采集写入；三家各自采集、单家失败只保留该家线上旧值并 `exit 1` 报红。Chrome 走 CWS API v2 `items/<id>:fetchStatus`（GET；在架 = `publishedItemRevisionStatus.distributionChannels[0].crxVersion`，审核中 = `submittedItemRevisionStatus...`），Edge 走店面端点 `getproductdetailsbycrxid/<crxId>`（官方 Partner Center API 没有读已发布版本的端点），Firefox 走 AMO 公开 API v5。本地自检：`node scripts/fetch-store-versions.mjs --dry-run`（直连被 RST 时加 `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=...`）。**2026-10-12 起**：根包 `exclude-paths` 生效后，`latest.json` 等价于**扩展版本**（只随扩展产物变化），它和 `stores.json` 的差距才是真差距；此前版本号被网站提交推高（如 v2.15.1 相对商店 2.10.1 的落差是历史膨胀，不是扩展真改了 5 个版本）。

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
- AMO：`manifest.firefox.json` 已声明 `data_collection_permissions`（邮箱/书签/PII）；审核要交**源码包** —— 每次 Release 已自动附带 `bookmark-sync-source-<ver>.zip`（`scripts/package-source.mjs` 生成：可复现构建的最小源码集 + 自动写入的 `BUILD.md` 构建说明），直接下载上传即可，**不用再手工打包**；提交给 AMO 的产物是 Vite 压缩 bundle；`gecko.id` 一经提交不可改。
- Chrome/Edge 提交 `extension/` 的 zip。

### 自动提交（2026-09-29 起，不再人工传包）

`.github/workflows/publish-stores.yml` 是**独立**工作流（`workflow_dispatch` 手动触发），从 GitHub Release 取回三个 zip 提交到三家商店；`release.yml` 完全不碰商店。用第三方 CLI `publish-browser-extension`（钉死 **`@6.1.1`**，`npx --yes` 拉取，**不进 `devDependencies`** —— 免得污染 `pnpm-lock.yaml` 与 AMO 源码包）。

- **★ 为什么独立工作流 + 手动触发，而不是挂在 release.yml 末尾等 Approve**：私有仓库 + Free 套餐**不支持** environment 保护规则（`Required reviewers` / `Wait timer` 均 422，见第 2 节要点）。于是把「放行」交给 `workflow_dispatch`：人点一次 Run workflow 就是审批动作，免费、纯浏览器。升级到 Pro 后可改回「`release.yml` 里挂 `environment: stores` + Required reviewers」。
- **凭证全部放在 GitHub Environment `stores`**（`Settings → Environments`；**Deployment branches 已限 `main`** —— 在别的分支触发本工作流会失败，这是刻意的）。job 声明 `environment: stores`；**environment secret/variable 只有 job 真正开始后才注入**，所以凭证预检步骤必须在 job 内部。

  | 名字                                                                         | 类型     | 来源                                                                                                                  |
  | ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
  | `CHROME_PUBLISHER_ID`                                                        | variable | CWS 开发者后台（当前值 `0d540b21-27e1-4770-8294-7505eb33fe5c`）                                                       |
  | `EDGE_PRODUCT_ID`                                                            | variable | Partner Center → 产品的 **Extension Identity**（小写 GUID，**不是**商店 URL 里的 `ilhfggggmdgfnliiimnkhdbaijjombah`） |
  | `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` / `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | secret   | GCP 服务账号 JSON 的 `client_email` / `private_key`                                                                   |
  | `EDGE_CLIENT_ID` / `EDGE_API_KEY`                                            | secret   | Partner Center → Publish API                                                                                          |
  | `FIREFOX_JWT_ISSUER` / `FIREFOX_JWT_SECRET`                                  | secret   | AMO → API Credentials                                                                                                 |

  公开常量（`CHROME_EXTENSION_ID`、`FIREFOX_EXTENSION_ID`、`CHROME_API_VERSION`）直接写死在 workflow 里。

- **一次性开通步骤**（三家各一次，做完不用再动）：
  - **Chrome**：GCP 建服务账号（本项目用 `bookmark-sync-publish` 项目，SA `catnuko6912@bookmark-sync-publish.iam.gserviceaccount.com`）→ 下载 JSON key → 取 `client_email` / `private_key` → **再去 CWS 后台 `设置 → 服务账号` 把 SA 邮箱加进去**（见下条，漏了这步 API 会 403）。
  - **Edge**：Partner Center → Publish API → 生成 Client ID + API key（**key 有 Expiry，约 72 天，到期必须轮换**）。
  - **Firefox**：AMO → 开发者中心 → 管理 API 密钥 → 拿 JWT issuer / secret。
- **★ Chrome 必须用 API v2 + Service Account**：CWS API v1.1 **2026-10-15 停用**（官方 Warning），workflow 里写死 `CHROME_API_VERSION: v2`。
- **★ 光建 SA 不够，必须在 CWS 后台授权**（2026-09-29 实测）：只建 SA 直接调 API 会返回 **403 `PERMISSION_DENIED`**（"Permission denied on resource ... (or it might not exist)"，措辞极具误导性 —— 看着像资源不存在，其实是没授权）。要到 **CWS 开发者信息中心 → `设置`（`/settings`）→「服务账号」区块 → 填 SA 邮箱 → 添加服务账号**；加完立即生效，**不需要点页面底部的「保存更改」**。**一个 publisher 只能挂 1 个 SA**。
- **★ 三家凭证都能「只读」自检**（不提交任何东西，改凭证后建议先跑一遍）：
  - Chrome：SA key 换 access token（`https://oauth2.googleapis.com/token`，`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`，scope `https://www.googleapis.com/auth/chromewebstore`）→ **`GET https://chromewebstore.googleapis.com/v2/publishers/<pub>/items/<ext>:fetchStatus`**（★ 是 **GET** 不是 POST；写成 POST 会得到 Google 前端的 HTML 404，看着像 API 没启用）。200 = 通；403 = SA 没在 CWS 授权。
  - Edge：**`GET https://api.addons.microsoftedge.microsoft.com/v1/products/<productId>/submissions/draft/package/operations/<任意 UUID>`** —— 凭证正确返回 **404**（鉴权过了、operation 不存在），凭证错误返回 **401**。这是唯一能区分鉴权的只读探针（`/v1/products/<id>` 之类未知路由一律 404，掩盖鉴权，不可用）。
  - Firefox：`GET https://addons.mozilla.org/api/v5/addons/addon/<id>/versions/` 带 `Authorization: JWT <token>` —— 200 且能看到 **`approval_notes`**（owner-only 字段）= 通；无 JWT 时该字段为 `undefined`；secret 错则 **401 "Error decoding signature."**。JWT 是 HS256、`{iss, jti, iat, exp}`、60 秒内有效且 jti 不可复用。
  - 本机跑这些探针要**走代理 `-x http://127.0.0.1:7897`**（Node 原生 fetch/https 不读代理 env，直连被 RST）。
- **★ 可选环境变量不能写成空串**：CLI 用 `?? process.env.X` 取值，空串会被当成「给了值」→ 配置校验直接失败（`vars.X` 未配置时正是渲染成空串）。所以可选项（`CHROME_PUBLISH_TYPE` / `CHROME_CANCEL_PENDING` / `FIREFOX_CHANNEL`）一律不写；必需项走 job 内的预检步骤点名。
- **★ `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` 必须是「真实换行」的 PEM**：CLI 只在**交互式 `init`** 里做 `replaceAll("\\n","\n")`，走环境变量时**不反转义** → 塞带字面 `\n` 的单行串会在签名时炸。用 `gh secret set` 从 stdin 灌原始 JSON 的 `private_key` 即可（`node -e 'process.stdout.write(require("<key.json>").private_key)' | gh secret set ...`）。
- **Node 必须 ≥ 22**：该 CLI 的 `engines.node` 是 `>=22.0.0`，publish job 用 Node 22（build job 的 Node 20 跑不了）。
- **三家分开调用 CLI**（不一次传三个 zip）：CLI 是「传了哪个 zip 才提交哪家」，分开跑可让一家失败不阻断另两家；各步骤 `continue-on-error` 收集结果，末尾统一 `exit 1` 让 run 变红。
- **Chrome 首轮用 `CHROME_PUBLISH_TYPE: STAGED_PUBLISH`**（提交审核但**不自动上架**，需在 CWS 后台点发布）—— 链路验证无误后删掉那一行即恢复「审核通过即全量发布」。
- **Edge 的 `--dry-run` 是空操作**（源码里明写无法在 dry run 校验 API key）→ Edge 凭证只能在真实提交时验证（用上面的只读探针代替）。
- 本地验证凭证（不污染线上商店；凭证放 gitignored 的 `.env.submit`，CLI 会自动加载）：

  ```bash
  pnpm package
  npx --yes publish-browser-extension@6.1.1 --dry-run \
    --chrome-zip dist/bookmark-sync-chromium-<ver>.zip \
    --firefox-zip dist/bookmark-sync-firefox-<ver>.zip \
    --firefox-sources-zip dist/bookmark-sync-source-<ver>.zip \
    --edge-zip dist/bookmark-sync-chromium-<ver>.zip
  ```

## 6. 与用户协作约定

- 改代码前先对齐方案，不自动 commit/push（需明确授权）。
- 视觉验证以截图对照参考实现为准。
- 本文件是开发注意事项，README 才是面向部署/发布的完整说明。
