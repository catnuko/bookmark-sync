# supabase-snaply-multi — 共享 Supabase 项目中央仓库

snaply 共享 Supabase 项目（ref: `cwtqnsbpcetvqopdkcou`）的**唯一写路径仓库**，一库多项目（多租户）。

## 唯一写路径
- 数据库：`supabase/migrations/*.sql` → `supabase db push`
- 边缘函数：`supabase/functions/<name>/index.ts` → `supabase functions deploy <name>`
- secrets：`supabase secrets set`（不写入代码）

## 多租户规范
- **接入/注册表/规范条文见 [supabase/TENANTS.md](supabase/TENANTS.md)**，新租户先读它再动代码。
- 应用仓库通过 git submodule 内置本仓库的 `supabase/` 目录；**不要在应用仓库里直接改本仓库代码**，改动在这里提交或提 PR，应用仓库用 `git submodule update --remote` 同步。

## 禁止
- 禁止用 MCP / Dashboard SQL 编辑器直接修改远端结构。
- 禁止跳过迁移文件直接执行 DDL。
- 禁止修改已提交的历史迁移（只新增迁移，不回头改 0001~0010）。

## 流程
- 数据库：`supabase migration new <name>` → 编辑 SQL → `supabase db push`（直连远端，无需本地数据库/Docker）。
- 边缘函数：编辑 `index.ts` → `supabase functions deploy <name>`。
- 每次变更后提交并 push 本仓库；需要远端写操作时，先给出迁移文件、函数代码或命令，等用户审查后再执行。

## 本地环境（沙箱无 Docker / 无本地 PostgreSQL）
- 读远端 schema：用 `introspect.js`（Node pg 直连，走 socat 隧道），不要把远端结构写入本地数据库。
- 本地验证迁移：可选 `embedded-postgres` 包（Node 嵌入式 Postgres），默认不安装。
