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
5. **权限最小化**：不重新放开 anon 权限；对 anon / authenticated 的授权显式、最小化并写进迁移；默认全量授权中的 TRUNCATE / REFERENCES / TRIGGER 必须显式 revoke（RLS 不拦截 TRUNCATE；PG17 起还有 `MAINTAIN` —— 正确姿势见规范 11 的 `revoke all` + 最小 grant，别逐项枚举）。**已收权的表不得再被 DROP 重建或重新 grant 全量 DML**（0032 堵的是「登录用户直改自己 plan/quota_bytes」的自提权，见 0040 开头）。
6. **边缘函数与存储桶**：`functions/<name>/` 目录名唯一；storage bucket 名带前缀并在此登记。
7. **auth.users**：登录账号体系唯一；管理员身份走 `bsync_admins`（0028 起），不再使用共享注册表。
8. **secrets**：secrets 命名带前缀区分用途；用 `supabase secrets set` 管理，不写入代码。
9. **对象注释**：新表 / 函数写中文 `COMMENT ON`（沿 0010 的做法），否则后续维护者无法理解。
10. **RLS 变更必须配 role-play 测试**：`SET LOCAL ROLE authenticated` + 伪造 JWT 正反用例（0027 提权事故沉淀）。
11. **★ 建表必须同迁移带 grant（2026-10-30 起强制）**：Supabase 停止对 public schema 新表/序列自动授予 Data API 权限（changelog #45329；官方 opt-in 语句 = `alter default privileges for role postgres in schema public revoke ...`）。因此**任何 `create table public.*` 的迁移，必须在同一个文件里写全 grant**。要授权的角色只有三个，按需选择：`anon`（仅公开表单类）、`authenticated`（一般只 `select`，写入走 SECURITY DEFINER RPC）、`service_role`（边缘函数直连直写）。
    - **自增主键的序列要不要授？**（实测结论，别凭直觉补）identity 列（`generated always as identity`，如 `bsync_waitlist.id`）**不需要** `grant usage` —— 身份序列由表内部持有，插入不检查调用者序列权限；serial 列（`default nextval(...)`）**只有**在 anon/authenticated 会**直接 insert** 时才需要（DEFAULT 表达式以调用者身份求值），若写入只发生在 SECURITY DEFINER RPC 内（以属主身份求值）则不需要。所以本仓现有表**一项序列授权都不需要**给客户端角色。
    - **收权一律用 `revoke all` + 重新 `grant` 最小集**，不要逐项枚举（枚举会随 PG 版本漂移：0032 就漏掉了 PG17 新增的 `MAINTAIN`）。
    - **禁止**用 `alter default privileges ... grant` 自救：那等于对所有未来表开放全量 DML，一次废掉 0032 的收权成果。
    - **禁止**用 `DROP TABLE + CREATE TABLE` 做迁移（0017 这么做时把在用的 grant 全抹了，见 0040）；真要重建就先在同迁移里把 grant 补回。
    - 存量表的授权现状见 `migrations/0040_explicit_data_api_grants.sql`（全量重放的基线）。

## 本地环境说明（沙箱无 Docker / 无本地 PostgreSQL）

- 读远端 schema：用 Node pg 直连（或 Management API `POST /v1/projects/{ref}/database/query` 跑只读 SELECT），不要把远端结构写入本地数据库。
- 本地验证迁移：可选 `embedded-postgres` 包（Node 嵌入式 Postgres），默认不安装。
