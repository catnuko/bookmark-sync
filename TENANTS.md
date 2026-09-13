# Supabase 多租户注册表（supabase-snaply-multi）

共享 Supabase 项目 ref：`cwtqnsbpcetvqopdkcou`（snaply）。本仓库是该项目的**唯一写路径**：
数据库变更走 `migrations/*.sql`，边缘函数走 `functions/<name>/index.ts`，
通过 Supabase CLI 部署到远端。应用仓库以 git submodule 内置本仓库的 `supabase/` 目录，
**不要在应用仓库里直接改这里的代码**。

## 已注册租户

| 租户 | 命名前缀 | 用途 | 归属仓库 | 状态 |
|---|---|---|---|---|
| bsync | `bsync_*` | 浏览器书签同步（快照 + 墓碑） | bookmark-sync | 已启用 |
| license | `lic_*` | License/Token 计费系统（lic_licenses / lic_user_tokens 等 4 表 + 3 RPC） | license-system | 已启用（0011 迁移从无前缀改为 lic_ 前缀） |
| 共享基础设施 | 无前缀 | projects / project_members / profiles / 余额函数 | supabase-snaply-multi | 已启用（多租户共享，不加前缀） |

> 新租户接入前，先在此表登记你的前缀与用途，再写迁移。

## 迁移号水位

- 当前最新迁移：`0016`（push 前先 `supabase migration list` 确认远端实际水位）
- 新迁移编号 = 当前水位 + 1（当前为 `0017`）
- **禁止修改已提交的历史迁移（0001~0016）**，只新增迁移文件

## 已占用命名（勿重复使用）

- 表前缀：`bsync_*`（bookmark-sync）；`lic_*`（license 计费）；无前缀共享表：`projects` / `project_members` / `profiles`
- license 专属表（0011 迁移重命名）：`lic_licenses` / `lic_usage_logs` / `lic_user_tokens` / `lic_user_profiles`
- license 专属函数（0011 迁移重命名）：`lic_consume_license` / `lic_extend_license` / `lic_consume_token`
- 余额函数（共享，无前缀）：`add_balance` / `consume_balance` / `get_balance` / `is_project_member` / `ensure_membership`
- 订阅边缘函数（带 bsync- 前缀）：`bsync-creem-checkout` / `bsync-creem-portal` / `bsync-creem-webhook`
- License 边缘函数（待改前缀，有外部调用方）：`create-token` / `generate-license` / `grant-subscription` / `my-tokens` / `redeem-card` / `revoke-token` / `validate-license`
- 存储桶：无（若新增，桶名带前缀并在此登记）

## 接入规范（所有仓库必须遵守）

1. **命名前缀**：public schema 中表 / 函数 / RLS 策略名全局唯一。新租户必须自选前缀（如 `xxx_*`），登记后再写代码。
2. **迁移号只增不重叠**：本仓库是唯一写迁移的地方；新迁移编号 = 当前水位 + 1，push 前先 `supabase migration list` 确认。
3. **本地代码驱动**：迁移文件 + 函数源码是唯一真实来源，用 `supabase db push` / `supabase functions deploy <name>` 部署；MCP / Dashboard 仅只读调试，禁止直接写远端。
4. **RLS 行级隔离**：所有新表必须 `enable row level security`，用 `project_id`（或自建 tenant 列）+ `auth.uid()` 策略隔离数据，不准靠"表名不同"当隔离手段。
5. **权限收紧一致**：不重新放开 anon 权限（0006 已 `revoke anon execute`）；对 anon / authenticated 的授权显式、最小化并写进迁移。
6. **边缘函数与存储桶**：`functions/<name>/` 目录名全局唯一；storage bucket 名带前缀并在本表登记。
7. **auth.users 共享**：登录账号体系全局唯一，跨租户区分用户靠业务表（如 `lic_user_profiles` 按 project 区分）。
8. **secrets**：secrets 是项目级的，同名会互相覆盖，命名必须带前缀；用 `supabase secrets set` 管理，不写入代码。
9. **对象注释**：新表 / 函数写中文 `COMMENT ON`（沿 0010 的做法），否则后续维护者无法理解。

## 本地环境说明（沙箱无 Docker / 无本地 PostgreSQL）

- 读远端 schema：用 `introspect.js`（Node pg 直连，走 socat 隧道），不要把远端结构写入本地数据库。
- 本地验证迁移：可选 `embedded-postgres` 包（Node 嵌入式 Postgres），默认不安装。
