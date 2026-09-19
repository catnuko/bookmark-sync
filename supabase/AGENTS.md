# supabase/ — bookmark-sync 专属 Supabase 目录（已内联于 bookmark-sync 仓库）

本目录承载 snaply Supabase 项目（ref: `cwtqnsbpcetvqopdkcou`）的全部 schema 与边缘函数，
**直接在 bookmark-sync 仓库内维护**（2026-09-19 起由独立中央仓库 + submodule 内联而来，
旧仓库 catnuko/supabase-snaply-multi 转为归档，历史随合并保留在本仓库）。
（单租户说明：license 子系统与共享注册表已于 0029 拆除，其逻辑保留在
并入的 git 历史中，恢复时在新项目重放相关迁移并部署函数即可。）

## 唯一写路径
- 数据库：`supabase/migrations/*.sql` → `supabase db push`
- 边缘函数：`supabase/functions/<name>/index.ts` → `supabase functions deploy <name>`
- secrets：`supabase secrets set`（不写入代码）

## 变更流程
- 改 `supabase/` 内代码 → Conventional Commits 提交并 push 本仓库 → 在 `supabase/` 目录执行部署命令。
- 需要远端写操作时，先给出迁移文件、函数代码或命令，等用户审查后再执行。

## 禁止
- 禁止用 MCP / Dashboard SQL 编辑器直接修改远端结构。
- 禁止跳过迁移文件直接执行 DDL。
- 禁止修改已提交的历史迁移（只新增迁移，不回头改历史文件）。

## 安全纪律（0027 事故沉淀）
- RLS 策略/权限变更必须配 role-play 测试：`SET LOCAL ROLE authenticated` + 伪造 JWT 正反用例各打一遍（见 0027 验证记录）。
- 对 anon / authenticated 的授权显式、最小化；表默认权限若含 TRUNCATE/REFERENCES/TRIGGER 必须显式 revoke（RLS 不拦截 TRUNCATE）。
- 新表/函数写中文 `COMMENT ON`。

## 本地环境（沙箱无 Docker / 无本地 PostgreSQL）
- 读远端 schema：用 Node pg 直连（或 Management API `POST /v1/projects/{ref}/database/query` 跑只读 SELECT），不要把远端结构写入本地数据库。
- 本地验证迁移：可选 `embedded-postgres` 包（Node 嵌入式 Postgres），默认不安装。
