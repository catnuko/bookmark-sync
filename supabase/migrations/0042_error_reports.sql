-- ============================================================================
-- 0042 error_reports.sql — 同步错误的诊断上报（元数据，绝不含书签内容）
-- 日期：2026-09-23
--
-- 背景：2026-09-23 上架后，唯一的故障信息来源是「用户投诉」。而 0.9.x 起
--   `describeError()` 已把「非 Error 抛出物」的可读化铺到全部 reason:'error' 路径
--   （src/lib/errors.ts），线上却仍然只能看到用户转述的一句话。结果是每次排障
--   都要先猜「他说的是哪一步失败」——正是 2026-09-22 E2E 排障踩过的那个坑，只是
--   这次发生在真实用户身上。
--   本迁移落地最小上报通道：**只有错误元数据**，用于回答「哪个 phase 的哪类错误
--   在哪个版本上高频出现」。
--
-- 隐私边界（硬约束，改本文件前先读）：
--   · 上报**只发生在前端已登录时**（未登录直接 return，不落任何行）；
--   · 载荷**禁止包含书签内容、网址、文件夹名、口令、任何 E2EE 明文**。
--     列集合本身就是白名单：phase / reason / error_name / error_message /
--     error_stack / context / app_version / platform。context 由调用方
--     **只填枚举型标量**（src/lib/telemetry.ts 会丢弃非标量、超长与超过 10 个键）；
--   · error_message 可能间接带上 URL（如 fetch 失败的 URL）→ 这是接受的风险，
--     已在隐私政策中披露，且不因此暴露任何可解密内容。
--
-- 为什么写入走 SECURITY DEFINER RPC（而不是给 authenticated 表级 INSERT）：
--   对齐 0032/0040 的收权基线 —— 客户端角色对 bsync_* 表一律不给写权限，
--   写入只经 RPC，由 RPC 内部做身份绑定（user_id := auth.uid()）、长度截断与限流。
--   这样 Data API 上**没有任何路径**可以伪造他人 user_id 或写超长载荷。
--
-- 限流口径（写清楚，别误读成「每分钟 20 次上报」）：
--   · 限流对象是**新增的不同指纹行**。同一指纹重复上报只累加 occurrences、
--     刷新 last_seen_at，不新增行 → 同一错误的重复上报成本恒定且可忽略；
--   · 因此 abuse 的唯一途径是「制造大量不同的错误指纹」，被两道闸门挡住：
--     每用户每分钟最多新增/刷新 20 行、最近 24 小时累计最多 200 行；
--   · 超限**静默 return（不抛错）**：上报是尽力而为的旁路，任何情况下都不该
--     变成一个用户可见的新失败。
--
-- 授权（TENANTS.md 规范 11 —— 建表必须同迁移写全 grant）：
--   anon / authenticated → 表：无；序列：无（identity 列，插入不检查序列权限）。
--   authenticated        → 仅 EXECUTE bsync_error_report(...)。
--   service_role         → 表 select/insert/update/delete + 序列 usage/select
--                          （对齐 0040 §3 的基线，供后台/运维查询）。
--   函数 EXECUTE 必须显式 revoke from PUBLIC —— PG 建函数默认给 PUBLIC 授权。
--
-- 幂等性：CREATE IF NOT EXISTS / OR REPLACE / 幂等 revoke+grant，可安全重放。
-- 自检 SQL：见文件末注释块。
-- ============================================================================

-- ---------- 1) 表 ----------
create table if not exists public.bsync_error_reports (
    id            bigint generated always as identity primary key,
    user_id       uuid        not null references auth.users (id) on delete cascade,
    -- 同一 (用户, 指纹) 只留一行：指纹 = md5(phase|reason|name|message 前 200 字)
    fingerprint   text        not null,
    phase         text        not null,
    reason        text        not null,
    error_name    text,
    error_message text,
    error_stack   text,
    context       jsonb       not null default '{}'::jsonb,
    app_version   text,
    platform      text,
    occurrences   int         not null default 1,
    first_seen_at timestamptz not null default now(),
    last_seen_at  timestamptz not null default now(),
    constraint bsync_error_reports_fp_uniq unique (user_id, fingerprint)
);

comment on table public.bsync_error_reports is
'客户端同步错误的诊断元数据（按 用户×指纹 聚合，occurrences 计频次）。仅存错误类型与调用阶段，绝不含书签内容 / 网址 / 口令 / 任何 E2EE 明文；写入仅经 bsync_error_report RPC（0042）。';
comment on column public.bsync_error_reports.fingerprint is
'md5(phase|reason|error_name|message 前 200 字)：同一错误重复出现只累加 occurrences，避免把表刷成流水账。';

alter table public.bsync_error_reports enable row level security;
-- 无 RLS 策略（默认全拒）：客户端只能经 SECURITY DEFINER RPC 写入（TENANTS #4）

-- ---------- 2) 授权（显式 + 最小；禁止靠平台默认权限） ----------
revoke all on public.bsync_error_reports from anon, authenticated;
revoke all on sequence public.bsync_error_reports_id_seq from anon, authenticated;
grant select, insert, update, delete on public.bsync_error_reports to service_role;
grant usage, select on sequence public.bsync_error_reports_id_seq to service_role;

-- ---------- 3) 上报 RPC ----------
create or replace function public.bsync_error_report(
    p_phase       text,
    p_reason      text,
    p_error_name  text,
    p_error_message text,
    p_error_stack text,
    p_context     jsonb,
    p_app_version text,
    p_platform    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_ctx       jsonb;
  v_phase     text;
  v_reason    text;
  v_msg       text;
  v_recent    int;
  v_daily     int;
  v_fp        text;
begin
  -- 未登录：不上报（也保证不会出现 user_id 为空的孤儿行）
  if v_user is null then
    return;
  end if;

  -- 长度截断：单字段上限，防单条载荷刷爆存储
  v_phase  := left(coalesce(nullif(p_phase, ''), 'unknown'), 40);
  v_reason := left(coalesce(nullif(p_reason, ''), 'unknown'), 60);
  v_msg    := left(coalesce(p_error_message, ''), 1000);

  -- context 必须是对象；超长则整体丢弃（不截断 JSON 文本 —— 那会得到非法 JSON）
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    v_ctx := '{}'::jsonb;
  elsif octet_length(p_context::text) > 2000 then
    v_ctx := jsonb_build_object('_omitted', true, '_bytes', octet_length(p_context::text));
  else
    v_ctx := p_context;
  end if;

  -- 限流（见文件头「限流口径」）：超限静默丢弃，不上抛
  select count(*) into v_recent
    from public.bsync_error_reports
   where user_id = v_user and last_seen_at > now() - interval '1 minute';
  if v_recent >= 20 then
    return;
  end if;

  select count(*) into v_daily
    from public.bsync_error_reports
   where user_id = v_user and last_seen_at > now() - interval '1 day';
  if v_daily >= 200 then
    return;
  end if;

  v_fp := md5(
    v_phase || '|' || v_reason || '|' || coalesce(p_error_name, '') || '|' || left(v_msg, 200)
  );

  insert into public.bsync_error_reports
    (user_id, fingerprint, phase, reason, error_name, error_message, error_stack,
     context, app_version, platform)
  values
    (v_user, v_fp, v_phase, v_reason,
     left(coalesce(p_error_name, ''), 120), v_msg, left(coalesce(p_error_stack, ''), 2000),
     v_ctx, left(coalesce(p_app_version, ''), 40), left(coalesce(p_platform, ''), 40))
  on conflict (user_id, fingerprint) do update
     set occurrences   = public.bsync_error_reports.occurrences + 1,
         last_seen_at  = now(),
         -- 保留最新一次的形状：指纹只取决于 message 前 200 字，故尾部可变
         error_stack   = excluded.error_stack,
         error_message = excluded.error_message,
         context       = excluded.context,
         app_version   = excluded.app_version;
end;
$$;

comment on function public.bsync_error_report(text, text, text, text, text, jsonb, text, text) is
'客户端错误上报（0042）：SECURITY DEFINER，user_id 取 auth.uid() 不可伪造；未登录直接返回，超限静默丢弃；按 (user_id, fingerprint) 聚合累加 occurrences。';

-- ---------- 4) 函数 EXECUTE 授权 ----------
-- PG 建函数默认授 EXECUTE 给 PUBLIC → 必须显式收回，再只授 authenticated
revoke all on function public.bsync_error_report(text, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.bsync_error_report(text, text, text, text, text, jsonb, text, text)
  to authenticated;

-- ============================================================================
-- 自检 SQL（执行后复核；也可与迁移一起放进 begin ... rollback 做零改动预演）
--
--   -- ① 表级权限：anon/authenticated 应为 0 项
--   select r.rolname, a.privilege_type
--     from pg_class c
--     cross join lateral aclexplode(c.relacl) a
--     join pg_roles r on r.oid = a.grantee
--    where c.relname = 'bsync_error_reports' and r.rolname in ('anon','authenticated');
--   -- 期望：0 行
--
--   -- ② RLS 已开且无策略
--   select relrowsecurity, (select count(*) from pg_policies
--     where schemaname='public' and tablename='bsync_error_reports') as policies
--     from pg_class where relname='bsync_error_reports' and relnamespace='public'::regnamespace;
--   -- 期望：t | 0
--
--   -- ③ 函数 EXECUTE：authenticated 有，anon/PUBLIC 无
--   select r.rolname, has_function_privilege(r.oid,
--            'public.bsync_error_report(text,text,text,text,text,jsonb,text,text)', 'EXECUTE') as can_exec
--     from pg_roles r where r.rolname in ('anon','authenticated','service_role','public');
--   -- 期望：anon=f, authenticated=t, service_role=f, public=f
--
--   -- ④ role-play（TENANTS #10）：authenticated 不能直插表（必须 42501）
--   begin;
--     set local role authenticated;
--     insert into public.bsync_error_reports (user_id, fingerprint, phase, reason)
--       values (auth.uid(), 'x', 'p', 'r');   -- 期望 42501
--   rollback;
-- ============================================================================
