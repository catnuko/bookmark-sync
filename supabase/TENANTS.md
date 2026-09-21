# Supabase 项目注册表（supabase-snaply）

共享 Supabase 项目 ref：`cwtqnsbpcetvqopdkcou`（snaply）。本目录是该项目的**唯一写路径**：
数据库变更走 `migrations/*.sql`，边缘函数走 `functions/<name>/index.ts`，
通过 Supabase CLI 部署到远端。**本目录已内联于 bookmark-sync 仓库**，直接改、直接提交
（旧中央仓库 catnuko/supabase-snaply-multi 已归档，历史随 subtree 合并保留）。

> 2026-09-19 起本项目收敛为 bookmark-sync 单租户：license 子系统（lic_* 表/函数、
> 7 个边缘函数）与共享注册表（projects/project_members/profiles/余额函数）已于
> 0029 拆除。其逻辑保留在 git 历史（0008/0011 等迁移 + functions/ 历史版本），
> 恢复时在新 Supabase 项目重放相关迁移并部署函数即可。

## 已注册租户

| 租户  | 命名前缀              | 用途                                            | 归属仓库      | 状态     |
| ----- | --------------------- | ----------------------------------------------- | ------------- | -------- |
| bsync | `bsync_*` + `admin_*` | 浏览器书签同步（Move-CRDT 操作日志 + 后台管理） | bookmark-sync | 唯一租户 |

> 若未来要接入新租户（新前缀/新产品），恢复本表的登记制度：先登记前缀与用途，再写迁移。

## 迁移编号（推导，不记账）

- **新迁移编号 = `supabase migration list` 显示的最高编号 + 1**。远端 migration 历史表是唯一权威状态，push 前先 `supabase migration list` 对账，不手工维护水位记录。
- **禁止修改已提交的历史迁移**，只新增迁移文件。

## 命名占用

- 表前缀：`bsync_*`（bookmark-sync，含后台表 `bsync_admins` / `bsync_admin_audit_log`）
- 函数前缀：`bsync_*`（业务）、`admin_*`（后台 RPC，bookmark-sync 专属）
- 边缘函数（带 bsync- 前缀）：`bsync-creem-checkout` / `bsync-creem-portal` / `bsync-creem-webhook`
- 存储桶：无（若新增，桶名带前缀并在此登记）

## 规范（必须遵守）

1. **命名前缀**：public schema 中表 / 函数 / RLS 策略名唯一，沿用 `bsync_*` / `admin_*` 既有划分。
2. **迁移号只增不重叠**：本仓库是唯一写迁移的地方；新迁移编号 = 当前水位 + 1，push 前先 `supabase migration list` 确认。
3. **本地代码驱动**：迁移文件 + 函数源码是唯一真实来源，用 `supabase db push` / `supabase functions deploy <name>` 部署；MCP / Dashboard 仅只读调试，禁止直接写远端。
4. **RLS 行级隔离**：所有新表必须 `enable row level security`，用户数据按 `auth.uid()` 隔离；管理类表（如 `bsync_admins`）可无策略（默认全拒），仅经 RPC / service_role 访问。
5. **权限最小化**：不重新放开 anon 权限；对 anon / authenticated 的授权显式、最小化并写进迁移；默认全量授权中的 TRUNCATE / REFERENCES / TRIGGER 必须显式 revoke（RLS 不拦截 TRUNCATE）。
6. **边缘函数与存储桶**：`functions/<name>/` 目录名唯一；storage bucket 名带前缀并在此登记。
7. **auth.users**：登录账号体系唯一；管理员身份走 `bsync_admins`（0028 起），不再使用共享注册表。
8. **secrets**：secrets 命名带前缀区分用途；用 `supabase secrets set` 管理，不写入代码。
9. **对象注释**：新表 / 函数写中文 `COMMENT ON`（沿 0010 的做法），否则后续维护者无法理解。
10. **RLS 变更必须配 role-play 测试**：`SET LOCAL ROLE authenticated` + 伪造 JWT 正反用例（0027 提权事故沉淀）。

## 本地环境说明（沙箱无 Docker / 无本地 PostgreSQL）

- 读远端 schema：用 Node pg 直连（或 Management API `POST /v1/projects/{ref}/database/query` 跑只读 SELECT），不要把远端结构写入本地数据库。
- 本地验证迁移：可选 `embedded-postgres` 包（Node 嵌入式 Postgres），默认不安装。
