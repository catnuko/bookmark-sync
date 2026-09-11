# Supabase 管理规则

本地代码驱动，远端只通过 Supabase CLI / CI 部署。**MCP 只读，CLI 写远端；迁移文件和函数源码是唯一真实来源。**

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
