-- ============================================================================
-- 0041 waitlist_read_lockdown.sql — 收回 bsync_waitlist 的越权读取面
-- 日期：2026-09-23
--
-- 问题（0025 遗留）：0025 写下的策略是
--     for select to authenticated using (true)
-- 而 bsync_waitlist **没有 user_id 列** —— `using (true)` 在这里等价于
-- 「任意登录用户都能经 Data API 导出全部订阅邮箱」。0025 落它时表里只有官网
-- 占位表单的测试数据、注释写的用途是「后台导出统计」；但后台导出走的是
-- Dashboard / service_role，**不受 RLS 约束，根本不需要这条策略**。
-- 2026-09-23 上架后该表开始承载真实用户邮箱 → 该问题从「无影响」升级为
-- 「一次投诉即合规事故」，故单独立迁移收掉。
--
-- 依赖核查（收权前必须确认，已核实 2026-09-23）：
--   · 全仓 grep `bsync_waitlist`，客户端引用**只有一处**：
--     website/src/views/DownloadView.vue → .from('bsync_waitlist').insert(...)
--     且**不链 .select()**，走的是无 RETURNING 的纯 INSERT 路径 → 只需 INSERT，
--     不需要 SELECT（0025 授予的 insert 已足够；这是 2026-09-23 权限探针实测过的
--     结论：INSERT ... RETURNING 才会额外要求 SELECT 策略，见当日记录）。
--   · 无管理后台读该表（website/src/admin/** 无引用）；
--     无边缘函数读该表（supabase/functions/** 无引用）。
--   · 运维 / Dashboard 导出以 postgres / service_role 身份执行 → 不经过 RLS。
--   ⇒ 收掉读取面对**任何现有路径零影响**。
--
-- 收权方式（对齐 0040 的「revoke all + 最小 grant」，不逐项枚举）：
--   ① drop policy bsync_waitlist_select —— 在 RLS 层关掉读取；
--   ② revoke select ... from authenticated —— 收回 0025 / 0040 授的 SELECT，
--      避免留下「授权还在、策略没了」的悬空授权（下次谁补一条 FOR SELECT 策略
--      就会原地复活越权面）。
--   保留：anon INSERT + authenticated INSERT（官网订阅表单，含未登录访客）。
--   不动 service_role（后台导出 / 运维面）。
--   序列无需处理：id 是 `generated always as identity`，身份序列由表内部持有，
--   INSERT 不检查调用者序列权限（TENANTS.md 规范 11）。
--
-- 幂等性：仅 drop policy / revoke / comment，可安全重放。
-- 执行后权限面：anon → INSERT；authenticated → INSERT；service_role 不变。
--
-- 自检 SQL（把 0041 与本块一起放进 begin ... rollback 预演，或执行后复核）：
--   -- ① 策略应只剩 insert
--   select policyname from pg_policies
--    where schemaname='public' and tablename='bsync_waitlist';
--   -- 期望：仅 bsync_waitlist_insert
--   -- ② authenticated 对该表只应剩 INSERT
--   select privilege_type
--     from pg_class c
--     cross join lateral aclexplode(c.relacl) a
--     join pg_roles r on r.oid = a.grantee
--    where c.relname='bsync_waitlist' and r.rolname='authenticated'
--    order by 1;
--   -- 期望：仅 INSERT
--   -- ③ role-play 反例（TENANTS #10）：以 authenticated 身份 select 应 0 行 / 42501
--   set local role authenticated;
--   select count(*) from public.bsync_waitlist;   -- 期望：permission denied (42501)
--   reset role;
--
-- 规范：TENANTS.md #10（RLS 变更必须配 role-play 测试）、#11（建表/收权同迁移）。
-- ============================================================================

-- ---------- 1) 关掉 RLS 读取面 ----------
drop policy if exists bsync_waitlist_select on public.bsync_waitlist;

-- ---------- 2) 收回悬空的表级 SELECT 授权 ----------
revoke select on public.bsync_waitlist from authenticated;

-- ---------- 3) 更新表注释，把「谁能读」写死在对象上 ----------
comment on table public.bsync_waitlist is
'官网「上架通知」订阅：仅收集邮箱与来源，不用于其他用途（隐私政策-我们收集什么）；写入 = anon / authenticated 均可 INSERT（官网表单），读取 = 仅 service_role（后台导出 / Dashboard，不经 RLS），客户端角色无 SELECT（0041 收回 0025 using(true) 的越权读取面）。';
