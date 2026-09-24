-- ============================================================================
-- 0040 explicit_data_api_grants.sql — public schema 的 Data API 权限基线
-- 日期：2026-09-23
--
-- 目的：把「谁能在 Data API 上对 public 的对象做什么」写成**显式 + 最小 + 可全量
--       重放**的基线。执行后，生产库的客户端权限面 = 全量重放（`db reset` /
--       preview branch / 新项目 / 灾备重建）的产物。
--
-- 背景：Supabase 2026-10-30 起对 public schema 的**新建**表 / 序列不再自动授予
--       Data API 权限（changelog #45329）——机制是撤销角色在 public 的默认权限。
--       实测远端 pg_default_acl：postgres 与 supabase_admin 各一对条目，给
--       anon / authenticated / service_role 授**全量 8 项表权限**
--       （DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE）
--       与 3 项序列权限（SELECT,UPDATE,USAGE）；**不含 PUBLIC**。
--       存量对象保留授权 → 生产库今天及 10-30 之后都照常，本迁移不解决"生产坏了"，
--       它解决的是"全量重放会得到另一个库"。
--
-- 缺口一（§1 补齐）：迁移文件里根本没写客户端授权，全库靠平台默认权限活着。
--   0017_v2_move_crdt.sql 用 `DROP TABLE + CREATE TABLE` 重建 7 张 bsync 表，
--   **把 0002 / 0013 / 0014 里写的显式 grant 一起 drop 掉了**；0017 建的
--   bsync_op_log、0028 的 bsync_admins、0025 的 bsync_waitlist 从未写过表级 grant。
--   ⇒ 10-30 之后任何全量重放都得到「Data API 不可见」的库：扩展直读
--     bsync_op_log / bsync_spaces / bsync_devices 全 42501，官网读不到 plan，
--     creem webhook（service_role）写不进订单。grant 检查发生在 RLS 之前，
--     加策略救不回来。
--
-- 缺口二（§0 回收）：默认权限给的是**全量 DML**，而 0032 的收权不彻底。
--   ① 枚举式 revoke 会随 PG 版本漂移：0032 逐项 revoke insert/update/delete/
--      truncate，**PG17 新增的 MAINTAIN 漏了** → 实测 7 张业务表 + bsync_waitlist +
--      bsync_admins 上 anon/authenticated 至今仍持有它。
--   ② 从未覆盖 bsync_admins（anon/authenticated 持全量 8 项）与 bsync_waitlist（同）。
--   ③ 4 个序列上 anon/authenticated 持 SELECT,UPDATE,USAGE —— 而实际一项都不需要
--      （见 §2 注释）。
--   ⇒ 收权的正确姿势是 `revoke all` 再 `grant` 最小集。这正是 §0 与 §1/§2 的
--     先后关系：执行后客户端权限面**不再取决于平台默认权限的取值，也不会随 PG
--     版本漂移**（枚举式 revoke 的漏项问题从根上消失）。
--
-- 授权粒度 = 0032 收权后的**最小权限**，**不是官方模板**。严禁照抄官方示例的
--   `grant select, insert, update, delete ... to authenticated` —— 那会重开 0032
--   专门堵掉的漏洞：登录用户经 Data API 直改自己的 plan / quota_bytes（绕过全部
--   付费闸门）、直插 op_log / devices / spaces（绕过配额与设备上限）。写入一律只走
--   SECURITY DEFINER RPC / 触发器 / service_role 边缘函数。实测 public 下 41 个
--   函数中仅 `bsync_plan_device_limit(plan)` 是 SECURITY INVOKER，且为纯 CASE 映射
--   无表访问 —— 即收掉表级权限不会打断任何 RPC 路径。
--
-- 执行后的完整权限面（本迁移的全部断言，可用下面的自检 SQL 复核）：
--   anon          → bsync_waitlist: INSERT。其余 10 表 + 全部 4 序列: 无。
--   authenticated → bsync_profiles / bsync_spaces / bsync_devices / bsync_op_log /
--                   bsync_snapshots / bsync_orders / bsync_subscriptions: SELECT；
--                   bsync_waitlist: INSERT, SELECT（0025 的设计意图：后台统计）。
--                   其余（bsync_admins / bsync_admin_audit_log / bsync_call_buckets
--                   及全部序列）: 无。
--   service_role  → 11 表 + 4 序列（webhook / portal / 运维面）。
--   postgres      → 属主，不受影响。
--   客户端未登录时不查这些表（website/src/lib/account.js 的 refreshProfile() 有
--   `if (!account.user) return` 前置），故收掉 anon 的读权限无行为影响。
--
-- 幂等性：仅 revoke / grant，无 DDL、无数据变更，可安全重放。
-- 范围：public 下全部 11 张 bsync_* 表 + 4 个序列。不触碰函数的 EXECUTE 授权
--       （各 RPC 内部自带 auth / admin 断言）。
-- 新增表：见 supabase/TENANTS.md 规范 11 —— 建表与 grant 必须写在同一迁移里。
-- ============================================================================

-- ---------- 0) 回收客户端角色的权限残留（fail-closed 前置） ----------
-- `revoke all` 一次收掉该角色在该对象上**直接持有**的全部权限（表的 8 项 / 序列的
-- 3 项），不受 PG 版本新增权限项影响。随后 §1 / §2 精确授回最小集。
-- 顺序不可调换：先归零，再授权。
-- 注：这几个对象的 grantor 全是 postgres（实测 aclexplode），故一条即可收干净。
revoke all on public.bsync_profiles      from anon, authenticated;
revoke all on public.bsync_spaces        from anon, authenticated;
revoke all on public.bsync_devices       from anon, authenticated;
revoke all on public.bsync_op_log        from anon, authenticated;
revoke all on public.bsync_snapshots     from anon, authenticated;
revoke all on public.bsync_orders        from anon, authenticated;
revoke all on public.bsync_subscriptions from anon, authenticated;
revoke all on public.bsync_waitlist      from anon, authenticated;
revoke all on public.bsync_admins        from anon, authenticated;
revoke all on public.bsync_admin_audit_log from anon, authenticated;
revoke all on public.bsync_call_buckets  from anon, authenticated;

revoke all on sequence public.bsync_op_log_id_seq          from anon, authenticated;
revoke all on sequence public.bsync_snapshots_id_seq       from anon, authenticated;
revoke all on sequence public.bsync_waitlist_id_seq        from anon, authenticated;
revoke all on sequence public.bsync_admin_audit_log_id_seq from anon, authenticated;

-- ---------- 1) 只读业务表：客户端（authenticated）仅 SELECT ----------
-- 这 7 张表在 0032 已 revoke 掉 INSERT / UPDATE / DELETE / TRUNCATE，
-- 客户端代码只直读（src/sync.ts、src/store.ts、website/src/lib/account.js）。
-- SELECT 同时是**必需**的：其中 6 张表的 RLS 策略子查询要读 bsync_spaces
-- （如 devices_owner: `space_id in (select id from bsync_spaces where owner_id = auth.uid())`），
-- 而策略表达式以调用者身份求值 —— 收掉 SELECT 会连带打断这些策略。
grant select on public.bsync_profiles      to authenticated;
grant select on public.bsync_spaces        to authenticated;
grant select on public.bsync_devices       to authenticated;
grant select on public.bsync_op_log        to authenticated;
grant select on public.bsync_snapshots     to authenticated;
grant select on public.bsync_orders        to authenticated;
grant select on public.bsync_subscriptions to authenticated;

-- ---------- 2) 官网等待名单：匿名可 INSERT，登录后可 SELECT ----------
-- 唯一的客户端直写路径（website/src/views/DownloadView.vue，未登录访客提交邮箱）。
-- 0025 的设计意图包含「authenticated 可 select（后台统计）」，予以保留。
--
-- ⚠ 不需要给任何序列授 USAGE，两个原因都实测过：
--   · bsync_waitlist.id 是 `generated always as identity` —— 身份列的序列由表内部
--     持有，插入不检查调用者的序列权限（事务内 revoke usage 后 anon 插入仍成功）。
--   · bsync_op_log / bsync_snapshots 的 id 是 serial（`default nextval(...)`），
--     但其写入只发生在 SECURITY DEFINER RPC 内（以属主 postgres 身份求值）。
--   反过来说：**若将来新增 serial 列且由 anon/authenticated 直接 insert，才需要
--   补 `grant usage on sequence`** —— 该规则已写进 TENANTS.md 规范 11。
grant insert         on public.bsync_waitlist to anon;
grant insert, select on public.bsync_waitlist to authenticated;

-- ---------- 3) service_role：边缘函数直读直写 ----------
-- bsync-creem-webhook / bsync-creem-portal / bsync-creem-checkout 用
-- SERVICE_ROLE_KEY 直连表（supabase/functions/*/index.ts），不走 RPC，且
-- service_role 不继承 authenticated 的授权 → 必须逐表显式授予。
-- 前 7 张 + bsync_waitlist 是业务读写面（含收款链路），后 3 张是内部表
-- （对客户端已收权，service_role 保留运维通道）。
grant select, insert, update, delete on public.bsync_profiles      to service_role;
grant select, insert, update, delete on public.bsync_spaces        to service_role;
grant select, insert, update, delete on public.bsync_devices       to service_role;
grant select, insert, update, delete on public.bsync_op_log        to service_role;
grant select, insert, update, delete on public.bsync_snapshots     to service_role;
grant select, insert, update, delete on public.bsync_orders        to service_role;
grant select, insert, update, delete on public.bsync_subscriptions to service_role;
grant select, insert, update, delete on public.bsync_waitlist      to service_role;
grant select, insert, update, delete on public.bsync_admins            to service_role;
grant select, insert, update, delete on public.bsync_admin_audit_log   to service_role;
grant select, insert, update, delete on public.bsync_call_buckets      to service_role;
grant usage, select on sequence public.bsync_waitlist_id_seq        to service_role;
grant usage, select on sequence public.bsync_admin_audit_log_id_seq to service_role;
grant usage, select on sequence public.bsync_snapshots_id_seq       to service_role;
grant usage, select on sequence public.bsync_op_log_id_seq          to service_role;

-- 刻意不授权的对象（§0 已显式收掉，不再依赖"默认权限兜底"或"RLS 零策略兜底"）：
--   anon          → 除 bsync_waitlist(INSERT) 外的任何表 / 序列；
--   authenticated → bsync_admins / bsync_admin_audit_log / bsync_call_buckets / 序列；
--   全部角色      → bsync_admin_audit_log 之外的写入面（写入走 SECURITY DEFINER RPC）。
--
-- 自检（应返回 0 行 —— 任何一行都是本迁移未覆盖的越权残留）：
--   select c.relname, r.rolname, a.privilege_type
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   cross join lateral aclexplode(c.relacl) a
--   join pg_roles r on r.oid = a.grantee
--   where n.nspname = 'public' and c.relkind in ('r','S')
--     and r.rolname in ('anon','authenticated')
--     and not (
--       (c.relname = 'bsync_waitlist' and r.rolname = 'anon' and a.privilege_type = 'INSERT')
--       or (c.relname = 'bsync_waitlist' and r.rolname = 'authenticated'
--           and a.privilege_type in ('INSERT','SELECT'))
--       or (r.rolname = 'authenticated' and a.privilege_type = 'SELECT'
--           and c.relname in ('bsync_profiles','bsync_spaces','bsync_devices',
--                             'bsync_op_log','bsync_snapshots','bsync_orders',
--                             'bsync_subscriptions'))
--     );
