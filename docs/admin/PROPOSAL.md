# BookmarkSync 后台管理系统 — 产品方案与落地方案

> 分支：`feat/admin-console`
> 范围：面向运营/作者本人的自托管后台，不开放给普通用户。
> 一句话定位：**在官网（`website/`）内挂一套 `/admin` 子站，复用现有 Supabase Auth，用多租户 `project_members` 表做管理员鉴权，只读为主、少量写操作为辅，全程不碰用户书签密文。**

---

## 1. 为什么需要它（项目现状 → 痛点）

bookmark-sync v2 的后端已经具备完整的业务实体，但全部面向"用户看自己的数据"：

| 已有实体 | 面向用户的能力 | 运营/作者的盲区 |
|---|---|---|
| `auth.users` + `bsync_profiles` | 自己的 plan / 用量 | 不知道总用户量、付费转化率、谁超额 |
| `bsync_subscriptions` / `bsync_orders` | 自己的订阅状态 | 不知道今天收了多少钱、谁在退订 |
| `bsync_spaces` / `bsync_devices` | 自己的空间和设备 | 不知道哪台设备最近活跃、哪里有异常 |
| `bsync_op_log` / `bsync_snapshots` | 自己的同步流 | 不知道日志增长速度、GC 是否在跑 |
| `licenses` / `user_tokens` | 自己的 token | 卡密发放、用量、停用全靠 Dashboard 手点 |

现在这些问题只能登录 Supabase Dashboard 裸查 SQL，每次都是临时手写查询，既不安全也不可复用。后台管理系统就是把这些高频查询固化成页面。

## 2. 针对本项目特点的设计取舍

这是本方案和"通用后台模板"最大的不同，必须先讲清楚：

1. **E2EE 是红线，后台永远看不到书签内容。**
   `bsync_op_log.op` 与 `bsync_snapshots.data` 都是客户端 AES-256-GCM 加密后的密文。后台只能统计**行数、字节大小、时间戳、来源设备**，不提供"查看某用户书签列表"这种功能——哪怕作者本人也不该看，这是产品隐私承诺（官网 FAQ 已写"服务器只见密文"）。

2. **复用多租户体系，不新建管理员表。**
   共享 Supabase 项目里已有 `project_members` + `is_project_member(project_id)`，bsync 的 `project_id = '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'`。把作者账号加进 `project_members` 即为管理员，不引入第二套账号系统，也不需要改 `auth.users`。

3. **唯一写路径仍是 Supabase 迁移文件。**
   遵循 `AGENTS.md` 与 `supabase/TENANTS.md`：所有 admin RPC 都写在 `0020_admin_rpc.sql`，是**待提交到中央 supabase 仓库**的迁移（本仓库只是引用它）。本分支不执行 `db push`，SQL 文件交付后由作者审查、提 PR 到 `catnuko/supabase-snaply-multi`。

4. **前端是官网的一部分，不是独立应用。**
   官网已是 Vue3 + Vite + vue-router + `@supabase/supabase-js`，加 `/admin` 子路由成本最低，也复用了已部署的 Vercel 域名与 SSL。`/admin/*` 路由加 `noindex`，不进 sitemap，不被 SEO 收录。

5. **不使用 service role key。**
   前端只持有 anon key。所有跨用户查询走 `SECURITY DEFINER` RPC，函数内部第一行就是 `is_project_member(...)` 校验，非成员直接 `raise exception 'forbidden'`。RLS 策略一个字都不改。

## 3. 角色与权限

| 角色 | 判定方式 | 能做什么 |
|---|---|---|
| 匿名 | 未登录 | 仅能访问 `/admin/login`，其它一律跳登录 |
| 普通登录用户 | 在 `auth.users` 但不在 `project_members` | 看到 403 页，提示"无权访问" |
| 管理员 | 在 `project_members(project_id=bsync)` 中 | 全部页面；只读为主，仅"改 plan / 停用 license / 重置配额"等少量写操作 |

管理员名单维护：作者本人在 Supabase Dashboard 往 `project_members` 插一行即可，无需后台界面（人少、低频，加界面是过度设计）。

## 4. 功能模块清单（可落地）

### 4.1 概览 Dashboard（首页 `/admin/`）

一屏看清生意：

- 核心指标卡：
  - 总用户数（`bsync_profiles` 行数）、今日新增、7 日新增
  - 付费用户数（`plan in ('plus','pro','lifetime')`）、付费率
  - 活跃设备数（`bsync_devices.last_seen_at` 在 24h 内）
  - 今日订单数、今日 GMV（`bsync_orders.amount_cents` 按 `status='paid'` 汇总）
  - `bsync_op_log` 总行数、总占用字节（监控 GC 是否健康）
- 趋势图：
  - 近 30 天每日新增用户
  - 近 30 天每日 GMV
- 异常列表：
  - 用量 > 80% 配额的用户（潜在流失/升级提示）
  - 最近 24h 报错订单（`status='failed'`）

### 4.2 用户管理 `/admin/users`

- 列表：邮箱、plan、used_count / quota_bytes（折算成"条"和"MB"）、设备数、空间数、注册时间、最后活跃时间
- 筛选：plan（free/plus/pro/lifetime）、关键词搜邮箱、按用量排序
- 分页：默认 50/页
- 行操作：
  - **查看详情**：进入 `/admin/users/:id`
  - **改 plan**：弹窗下拉切换 plan（free/plus/pro/lifetime），走 `admin_set_user_plan`
  - **重置配额**：清空 `used_bytes` / `used_count`（用于客服补偿）
- 用户详情页 `/admin/users/:id`：
  - 基本信息卡（邮箱、注册时间、plan、配额、E2EE salt 是否设置）
  - 订阅卡（当前订阅状态、当前周期截止日、Creem 客户 ID）
  - 设备列表（设备名、最后在线、所属空间）
  - 空间列表（空间名、是否默认、op_log 条数）
  - 订单流水（最近 20 条）
  - **明确提示**：书签内容为端到端加密，后台不展示

### 4.3 订阅与订单 `/admin/orders`

- 顶部汇总：本月 GMV、本月新增订阅、流失率（canceled/expired 数）
- 订单流水表：时间、用户邮箱、plan、金额（按 `currency` 本地化）、状态（pending/paid/refunded/failed）、Creem order id
- 筛选：状态、plan、时间范围
- 订阅列表视图：当前所有 `active` 订阅，用户、plan、到期时间、是否 scheduled_cancel

### 4.4 License / Token 卡密 `/admin/licenses`

（共享 license 子系统，bsync 项目用同一批卡）

- License 卡表：卡号前缀、到期日、最大用量、已用次数、状态
- 操作：停用/启用、延长有效期（复用已有 `extend_license` 语义）、查看使用日志（IP / UA / 时间 / 结果）
- Token 卡表：用户、token 前缀（只显示前 8 位 + 后 4 位）、plan、到期、状态
- 不做"批量生成"——生成走已有的 `generate-license` 边缘函数，后台只读 + 启停，避免双重写入路径。

### 4.5 系统监控 `/admin/system`

- `bsync_op_log` 总行数、按空间 Top 10（最占空间的用户）
- `bsync_snapshots` 每个用户最新快照字节大小 Top 10
- GC 健康：最近一次快照时间距今多少小时（判断客户端 GC 是否在跑）
- 最近错误订单、最近 revoke 的 token

### 4.6 登录页 `/admin/login`

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
       ├─ 第一行: PERFORM is_project_member('885e7f27-...')
       │         非成员 RAISE EXCEPTION 'forbidden'
       └─ 只读 bsync_* / 订单 / 订阅 / license 表，写操作仅改 profile.plan 等少量列
```

### 5.1 后端 RPC 清单（写在 `0020_admin_rpc.sql`）

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `admin_whoami()` | 无 | `{is_admin, email}` | 路由守卫用；非管理员返回 `is_admin=false` 而非抛错 |
| `admin_overview()` | 无 | 聚合 jsonb：用户/付费/设备/订单/op_log 计数与趋势 | 首页 |
| `admin_list_users(p_search text, p_plan text, p_sort text, p_limit int, p_offset int)` | 分页+筛选 | `{rows, total}` | 用户列表 |
| `admin_get_user(p_user uuid)` | 用户 id | jsonb：profile + spaces + devices + orders(最近20) + subscription | 用户详情 |
| `admin_set_user_plan(p_user uuid, p_plan text)` | 用户 id + 新 plan | void | 改 plan；记录到 `admin_audit_log` |
| `admin_reset_usage(p_user uuid)` | 用户 id | void | 清零 used_bytes/used_count |
| `admin_list_orders(p_status text, p_limit int, p_offset int)` | 筛选分页 | `{rows, total}` | 订单流水 |
| `admin_list_subscriptions(p_status text)` | 状态 | jsonb 数组 | 订阅列表 |
| `admin_list_licenses(p_active bool, p_limit, p_offset)` | 筛选分页 | `{rows, total}` | License 卡 |
| `admin_set_license_active(p_id uuid, p_active bool)` | 卡 id + 状态 | void | 启停 |
| `admin_system_stats()` | 无 | jsonb：op_log 总量、Top 用户 | 监控页 |
| `admin_audit_log` | （表） | — | 记录谁在什么时候改了哪个用户 |

所有函数：
- `SECURITY DEFINER` + `SET search_path = public`
- 开头：`if not public.is_project_member(bsync_project_id) then raise exception 'forbidden'; end if;`
- 结尾 `COMMENT ON FUNCTION ... IS '...'`（沿 TENANTS.md 规范 9）

## 6. 前端文件清单

```
website/src/admin/
├─ index.js                  # admin 路由表（被主 router 引用）
├─ lib/
│  ├─ auth.js                # 登录态 + isAdmin 响应式状态 + 路由守卫
│  ├─ client.js              # 封装 supabase.rpc('admin_*')，统一错误处理
│  └─ format.js              # 字节/时间/货币/plan badge 格式化（纯函数，可单测）
├─ components/
│  ├─ AdminLayout.vue        # 侧边栏 + 顶栏
│  ├─ StatCard.vue           # 指标卡
│  ├─ DataTable.vue          # 通用表格（loading/空态/分页）
│  └─ StatusBadge.vue        # plan/order/subscription 状态着色
└─ views/
   ├─ AdminLoginView.vue
   ├─ AdminDashboardView.vue
   ├─ AdminUsersView.vue
   ├─ AdminUserDetailView.vue
   ├─ AdminOrdersView.vue
   ├─ AdminSubscriptionsView.vue
   ├─ AdminLicensesView.vue
   ├─ AdminSystemView.vue
   └─ AdminForbiddenView.vue
```

主路由 `website/src/router/index.js` 追加 `/admin` 段，`meta.requiresAdmin = true`，全局 `beforeEach` 守卫调用 `adminAuth.requireAdmin(to)`。

## 7. 安全设计 checklist

- [x] 前端只持 anon key；跨用户数据只走 `admin_*` RPC
- [x] 每个 RPC 内部硬编码 bsync project_id 做成员校验（不接受前端传 project_id）
- [x] 改 plan / 启停 license 全部写 `admin_audit_log`（谁、何时、改了谁、改前/改后值）
- [x] `/admin/*` 在响应头/HTML meta 加 `noindex`（Vercel 静态站层面由 robots 规则覆盖）
- [x] 不展示任何书签密文、URL 明文（快照里可能含 URL，但加密；op_log.op 是密文，不 select 它）
- [x] 登录失败不回显"邮箱不存在 vs 密码错"（Supabase 默认行为，前端不二次拼接）
- [ ] 上线后建议在 Vercel 给 `/admin/*` 加 Basic Auth 或 IP allowlist（部署侧配置，不在代码里）

## 8. 落地与自测

### 8.1 本分支交付物
1. `docs/admin/PROPOSAL.md`（本文件）
2. `docs/admin/0020_admin_rpc.sql`（待提交到中央 supabase 仓库的迁移）
3. `website/src/admin/**`（前端全部代码）
4. `tests/admin/**`（vitest 单测）

### 8.2 自测口径
- `pnpm --dir website build`：Vite 构建通过，`/admin/*` 路由 chunk 产出
- `pnpm test`（根目录 vitest）：admin 纯函数与 API 层 mock 全绿
- 本地 `pnpm --dir website dev`：
  - 未登录访问 `/admin/users` → 跳 `/admin/login`
  - 登录非管理员 → 403
  - （作者把自己加进 `project_members` 后）各页面可加载、表格有数据

### 8.3 后续部署步骤（作者操作，不在本分支自动执行）
1. 把 `0020_admin_rpc.sql` 复制到中央仓库 `catnuko/supabase-snaply-multi` 的 `migrations/0020_admin_rpc.sql`，提 PR 合并
2. 在中央仓库目录跑 `supabase db push`
3. 在 `project_members` 给作者账号插一行 `(bsync_project_id, <author_uid>, 'admin')`
4. 本分支 `feat/admin-console` 合并到 main，Vercel 自动部署 `/admin/*`
5. 访问 `https://www.bookmark-sync.top/admin` 登录验证

## 9. 不做什么（明确边界）

- 不做"用户画像/标签/推送"——单用户产品，过度设计
- 不做"多管理员角色分权"（super/editor/viewer）——现在只有作者一人
- 不做"批量邮件营销"——官网已用别的渠道
- 不做"实时日志 tail"——Supabase 本身有 Dashboard logs，重复建设
- 不做"书签内容搜索/查看"——E2EE 红线
- 不改任何已有 RLS 策略、不动扩展端代码
