# BookmarkSync 后台管理系统 — 产品方案与落地方案

> 分支：`dev` / `main`（已于 v2.2.0 随官网合并上线）
> 范围：面向运营/作者本人的自托管后台，不开放给普通用户。
> 一句话定位：**在官网（`website/`）内挂一套 `/admin` 子站，复用现有 Supabase Auth，用多租户 `project_members` 表做管理员鉴权，只读为主、少量写操作为辅，全程不碰用户书签密文。**
> 文档同步状态：本文件已同步至 0026（2026-09-18）。历史差异见文末「变更记录」。

---

## 1. 为什么需要它（项目现状 → 痛点）

bookmark-sync v2 的后端已经具备完整的业务实体，但全部面向"用户看自己的数据"：

| 已有实体 | 面向用户的能力 | 运营/作者的盲区 |
|---|---|---|
| `auth.users` + `bsync_profiles` | 自己的 plan / 用量 | 不知道总用户量、付费转化率、谁超额 |
| `bsync_subscriptions` / `bsync_orders` | 自己的订阅状态 | 不知道今天收了多少钱、谁在退订 |
| `bsync_spaces` / `bsync_devices` | 自己的空间和设备 | 不知道哪台设备最近活跃、哪里有异常 |
| `bsync_op_log` / `bsync_snapshots` | 自己的同步流 | 不知道日志增长速度、GC 是否在跑 |

现在这些问题只能登录 Supabase Dashboard 裸查 SQL，每次都是临时手写查询，既不安全也不可复用。后台管理系统就是把这些高频查询固化成页面。

## 2. 针对本项目特点的设计取舍

这是本方案和"通用后台模板"最大的不同，必须先讲清楚：

1. **E2EE 是红线，后台永远看不到书签内容。**
   `bsync_op_log.op` 与 `bsync_snapshots.data` 都是客户端 AES-256-GCM 加密后的密文。后台只能统计**行数、字节大小、时间戳、来源设备**，不提供"查看某用户书签列表"这种功能——哪怕作者本人也不该看，这是产品隐私承诺（官网 FAQ 已写"服务器只见密文"）。

2. **复用多租户体系，不新建管理员表。**
   共享 Supabase 项目里已有 `project_members` + `is_project_member(project_id)`，bsync 的 `project_id = '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'`。把作者账号加进 `project_members` 即为管理员，不引入第二套账号系统，也不需要改 `auth.users`。

3. **唯一写路径仍是 Supabase 迁移文件。**
   遵循 `AGENTS.md` 与 `supabase/TENANTS.md`：所有 admin RPC 都以迁移形式落地在中央仓库 `catnuko/supabase-snaply-multi` 的 `supabase/migrations/`（`0020`~`0026`），由 `supabase db push` 部署。不在 Dashboard / MCP 直接改结构。

4. **前端是官网的一部分，不是独立应用。**
   官网已是 Vue3 + Vite + vue-router + `@supabase/supabase-js`，加 `/admin` 子路由成本最低，也复用了已部署的 Vercel 域名与 SSL。`/admin/*` 路由被 robots 规则 `Disallow: /admin` 排除出收录。

5. **不使用 service role key。**
   前端只持有 anon key。所有跨用户查询走 `SECURITY DEFINER` RPC，函数内部第一行就是 `is_project_member(...)` 校验，非成员直接 `raise exception 'forbidden'`。RLS 策略一个字都不改。

## 3. 角色与权限

| 角色 | 判定方式 | 能做什么 |
|---|---|---|
| 匿名 | 未登录 | 仅能访问 `/admin/login`，其它一律跳登录 |
| 普通登录用户 | 在 `auth.users` 但不在 `project_members` | 看到 403 页，提示"无权访问" |
| 管理员 | 在 `project_members(project_id=bsync)` 中 | 全部页面；只读为主，仅"改 plan / 重置用量 / 清空数据 / GC 维护"等少量写操作 |

管理员名单维护：作者本人在 Supabase Dashboard 往 `project_members` 插一行即可，无需后台界面（人少、低频，加界面是过度设计）。所有后台写操作写入 `bsync_admin_audit_log`，前台 `/admin/audit` 可查。

## 4. 功能模块清单（已落地）

### 4.1 概览 Dashboard（首页 `/admin/`）

一屏看清生意：

- 核心指标卡：
  - 总用户数（`bsync_profiles` 行数）、今日新增、7 日新增
  - 付费用户数（`plan in ('plus','pro','lifetime')`）、付费率
  - 活跃设备数（`bsync_devices.last_seen_at` 在 24h 内）
  - 今日订单数、今日 GMV（`bsync_orders.amount_cents` 按 `status='paid'` 汇总）
  - `bsync_op_log` 总行数、总占用字节（监控 GC 是否健康）
  - 用量 > 80% 配额的用户数
- 趋势图：
  - 近 30 天每日新增用户（手绘 SVG 折线，不引第三方图表库）
  - 近 30 天每日 GMV

### 4.2 用户管理 `/admin/users`

- 列表：邮箱、plan、used_count / quota_bytes（折算成"条"和"MB"）、设备数、空间数、注册时间、最后活跃时间
- 筛选：plan（free/plus/pro/lifetime）、关键词搜邮箱
- 分页：默认 50/页
- 行操作：查看详情 → `/admin/users/:id`
- 用户详情页 `/admin/users/:id`：
  - 基本信息卡（邮箱、注册时间、plan、配额、E2EE salt 是否设置）
  - 订阅卡（当前订阅状态、当前周期截止日、Creem 客户 ID）
  - 空间列表（空间名、是否默认、op_log 条数）
  - 设备列表（设备名、最后在线、所属空间）
  - 订单流水（最近 20 条）
  - **改 plan**（下拉切换，写审计）、**重置用量**（客服补偿，写审计）
  - **GC 监控与维护**（见 4.5）
  - **危险操作：一键清空同步数据**（双重确认，写审计，见 4.6）
  - **明确提示**：书签内容为端到端加密，后台不展示

### 4.3 订阅与订单 `/admin/orders` + `/admin/subscriptions`

- 订单流水表：时间、用户邮箱、plan、金额（按 `currency` 本地化）、状态（pending/paid/refunded/failed）、Creem order id
- 筛选：状态、plan、时间范围
- 订阅列表视图：当前所有订阅，用户、plan、到期时间、是否 scheduled_cancel；active 排前

### 4.4 操作审计 `/admin/audit`（0026 新增）

- 展示 `bsync_admin_audit_log`：谁（管理员邮箱）在何时做了什么操作、改了谁、改前/改后值（detail）
- 筛选：按 action（set_plan / reset_usage / reset_user_data / set_gc_threshold / request_gc）
- 分页：默认 50/页
- 数据只经 `admin_list_audit_log` RPC 读取；审计表本身 revoke 了 anon/authenticated 直连

### 4.5 系统监控 `/admin/system`（含 GC 托管）

- `bsync_op_log` 总行数、总字节；`bsync_snapshots` 快照数
- GC 健康：最近一次快照时间、**待响应 GC 用户数**、**超阈值空间数**（0024 扩展）
- op_log 占用 Top 10 用户
- 单用户 GC 维护（0024，位于用户详情页）：
  - 有效 GC 阈值（显式设置值或计划默认 free 2000 / pro、lifetime 20000）
  - 各空间 op 行数、最新快照体积/水位/时间
  - **保存阈值**（0 = 恢复按计划默认，写审计）、**请求压缩**（置 `gc_requested`，设备下次同步自动执行，写审计）

### 4.6 一键清空测试数据（0023）

- 从插件「高级 → 测试工具」移入后台用户详情页的**危险操作卡**
- 双重确认后调 `admin_reset_user_data`：按外键顺序删除该用户全部空间/操作日志/快照/设备，并重置 E2EE 盐与用量
- 删除完成后展示删除统计（空间/op/快照/设备数），全程不读取密文，写审计

### 4.7 登录页 `/admin/login`

- 邮箱 + 密码（复用 Supabase Auth，与官网/扩展同账号体系）
- 登录后调 `admin_whoami()`，非管理员跳 403

## 5. 技术架构

```
浏览器
  └─ website/ (Vue3 SPA, /admin/* 路由)
       ├─ AdminLayout.vue（侧边栏 + 顶栏，独立于官网 AppHeader）
       ├─ views/*.vue
       └─ lib/adminClient.js  ──► supabase.rpc('admin_*')
                                      │
Supabase Postgres  ◄────────────────┘
  └─ admin_* 函数（SECURITY DEFINER）
       ├─ 第一行: PERFORM assert_bsync_admin()
       │         （内部校验 is_project_member('885e7f27-...')，非成员抛 forbidden）
       └─ 只读 bsync_* / 订单 / 订阅 表；写操作仅改 plan / 用量 / GC / 清空数据，全部记审计
```

### 5.1 后端 RPC 清单（迁移 0020~0026）

| 函数 | 迁移 | 入参 | 说明 |
|---|---|---|---|
| `bsync_admin_project_id()` | 0020 | 无 | bsync 租户 project_id 常量，硬编码防伪造 |
| `assert_bsync_admin()` | 0020 | 无 | 管理员断言：非成员抛 forbidden，所有 admin_* 第一行调用 |
| `admin_whoami()` | 0020 | 无 | 路由守卫用：`{is_admin, email}`，非管理员不抛错 |
| `admin_overview()` | 0020 | 无 | 首页聚合：用户/付费/设备/订单/op_log + 30 天趋势 |
| `admin_list_users(p_search, p_plan, p_sort, p_limit, p_offset)` | 0020 | 分页+筛选 | 用户列表（含设备/空间数/最后活跃聚合） |
| `admin_get_user(p_user)` | 0020 | 用户 id | 详情：profile + 订阅 + 空间 + 设备 + 最近 20 条订单 |
| `admin_set_user_plan(p_user, p_plan)` | 0020 | id + plan | 改 plan 并对齐配额；写审计 |
| `admin_reset_usage(p_user)` | 0020 | 用户 id | 清零 used_bytes/used_count；写审计 |
| `admin_list_orders(p_status, p_plan, p_limit, p_offset)` | 0020 | 筛选分页 | 订单流水（join 邮箱） |
| `admin_list_subscriptions(p_status)` | 0020 | 状态 | 订阅列表，active 排前 |
| `admin_system_stats()` | 0020+0024 | 无 | 监控：op_log 量 + GC 健康 + Top 用户（0024 扩展待 GC/超阈值） |
| `admin_reset_user_data(p_user)` | 0023 | 用户 id | 一键清空同步数据 + 重置盐/用量；写审计 |
| `admin_get_gc_stats(p_user)` | 0024 | 用户 id | 单用户 GC 监控（阈值/最近 GC/各空间 op 与快照元数据） |
| `admin_set_gc_threshold(p_user, p_threshold)` | 0024 | id + 阈值 | 设动态 GC 阈值（0=默认）；写审计 |
| `admin_request_gc(p_user)` | 0024 | 用户 id | 置 gc_requested，设备下次同步自动压缩；写审计 |
| `admin_list_audit_log(p_action, p_target, p_limit, p_offset)` | 0026 | 筛选分页 | 审计日志查询（join 管理员/目标邮箱） |

所有函数：
- `SECURITY DEFINER` + `SET search_path = public`
- 开头：`perform public.assert_bsync_admin();`
- 匿名角色 `revoke all`，仅 `authenticated` 可调用（函数内再做管理员断言）
- 结尾 `COMMENT ON FUNCTION ... IS '...'`（沿 TENANTS.md 规范 9）

## 6. 前端文件清单

```
website/src/admin/
├─ index.js                  # admin 路由表（被主 router 引用）
├─ lib/
│  ├─ auth.js                # 登录态 + isAdmin 响应式状态 + 路由守卫
│  ├─ client.js              # 封装 supabase.rpc('admin_*')，统一错误处理
│  └─ format.js              # 字节/时间/货币/plan/审计明细格式化（纯函数，可单测）
├─ components/
│  ├─ AdminLayout.vue        # 侧边栏 + 顶栏
│  ├─ StatCard.vue           # 指标卡
│  ├─ DataTable.vue          # 通用表格（loading/空态/分页）
│  └─ StatusBadge.vue        # plan/order/subscription 状态着色
└─ views/
   ├─ AdminLoginView.vue
   ├─ AdminDashboardView.vue
   ├─ AdminUsersView.vue
   ├─ AdminUserDetailView.vue   # 含 GC 维护 + 一键清空（双重确认）
   ├─ AdminOrdersView.vue
   ├─ AdminSubscriptionsView.vue
   ├─ AdminAuditView.vue        # 0026 新增
   ├─ AdminSystemView.vue
   └─ AdminForbiddenView.vue
```

主路由 `website/src/router/index.js` 追加 `/admin` 段，`meta.requiresAdmin = true`，全局 `beforeEach` 守卫调用 `adminGuard(to)`（内部 `requireAdmin`）。

## 7. 安全设计 checklist

- [x] 前端只持 anon key；跨用户数据只走 `admin_*` RPC
- [x] 每个 RPC 内部硬编码 bsync project_id 做成员校验（不接受前端传 project_id）
- [x] 全部写操作（改 plan / 重置用量 / 清空数据 / GC 阈值 / 请求 GC）写入 `bsync_admin_audit_log`，且前台可查（0026）
- [x] `/admin/*` 被 robots 规则 `Disallow: /admin` 排除出收录
- [x] 不展示任何书签密文、URL 明文（快照里可能含 URL，但加密；op_log.op 是密文，不 select 它）
- [x] 危险操作（清空数据）前端双重确认 + 后端 RPC 内只删目标用户 owner_id 数据
- [x] 登录失败不回显"邮箱不存在 vs 密码错"（Supabase 默认行为，前端不二次拼接）
- [ ] 上线后建议在 Vercel 给 `/admin/*` 加 Basic Auth 或 IP allowlist（部署侧配置，不在代码里）

## 8. 落地与自测

### 8.1 交付物
1. `docs/admin/PROPOSAL.md`（本文件，同步至 0026）
2. `supabase/migrations/0020~0026`（中央仓库 `catnuko/supabase-snaply-multi`；应用仓库 `supabase/` 为子模块引用）
3. `website/src/admin/**`（前端全部代码）
4. `tests/admin/**`（vitest 单测）

### 8.2 自测口径
- `pnpm --dir website build`：Vite 构建通过，`/admin/*` 路由 chunk 产出（含 AdminAuditView）
- `pnpm vitest run`：admin 纯函数与 API 层 mock 全绿（当前 21 个 admin 用例）
- 本地 `pnpm --dir website dev`：
  - 未登录访问 `/admin/users` → 跳 `/admin/login`
  - 登录非管理员 → 403
  - （作者在 `project_members` 中）各页面可加载、表格有数据、审计页可查

### 8.3 部署步骤（作者操作）
1. 迁移已随中央仓库入库：`0020 admin_rpc` / `0021 space_create_auth` / `0022 fix_space_quota` / `0023 admin_reset_user_data` / `0024 admin_gc_managed` / `0025 waitlist` / `0026 admin_audit_view`
2. 在 `supabase/` 目录跑 `supabase db push`（0023~0026 若尚未部署，一次补齐；0020 已于 9/15 部署）
3. 在 `project_members` 给作者账号插一行 `(bsync_project_id, <author_uid>, 'admin')`
4. 前端已随 v2.2.0 上线 main；后续 dev 提交合并 main 后 Vercel 自动部署
5. 访问 `https://www.bookmark-sync.top/admin` 登录验证

## 9. 不做什么（明确边界）

- 不做"用户画像/标签/推送"——单用户产品，过度设计
- 不做"多管理员角色分权"（super/editor/viewer）——现在只有作者一人
- 不做"批量邮件营销"——官网已用别的渠道
- 不做"实时日志 tail"——Supabase 本身有 Dashboard logs，重复建设
- 不做"书签内容搜索/查看"——E2EE 红线
- 不做"License/Token 卡密管理界面"——卡密子系统（`licenses`/`user_tokens`）归共享项目，0020 已移除相关 RPC，避免双重写入路径；卡密操作仍走已有边缘函数与 Dashboard
- 不改任何已有 RLS 策略、不动扩展端代码

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-14 | 初版（分支 `feat/admin-console`，含 license 模块设想） |
| 2026-09-15 | 0020 部署生产；分支迁移至 `dev` 并删除 feat 分支；卡密 RPC 移除 |
| 2026-09-17 | 0023 一键清空、0024 GC 托管入库 |
| 2026-09-18 | 0026 审计查看页（`/admin/audit`）；本文件同步：删 license 模块、补 GC/清空/审计，RPC 清单更新为 16 个 |
