-- ============================================================================
-- 0020 admin_rpc.sql — BookmarkSync 后台管理系统 RPC
-- 日期：2026-09-14
-- 背景：website/ 新增 /admin 子站（见 docs/admin/PROPOSAL.md）。前端只持 anon key，
--       所有跨用户查询/少量写操作通过本文件定义的 admin_* RPC 暴露。
--
-- 安全模型：
--   1. 管理员判定复用共享多租户体系：project_members(project_id, user_id)。
--      bsync 租户固定 project_id = '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'。
--   2. 所有 admin_* 函数均为 SECURITY DEFINER，函数体第一行调用
--      assert_admin()，非成员直接 RAISE EXCEPTION 'forbidden'。
--   3. 前端无法伪造 project_id（函数内硬编码常量）。
--   4. 不 select bsync_op_log.op / bsync_snapshots.data（E2EE 密文），只统计元数据。
--
-- 幂等性：DROP ... IF EXISTS / CREATE ... IF NOT EXISTS / OR REPLACE，可安全重放。
-- 范围：仅新增 admin_* 对象；不修改已有表、不改已有 RLS 策略。
-- ============================================================================

-- ---------- 0) 常量与鉴权辅助 ----------
-- bsync 租户 project_id（与 licenses/project_members 里的默认值一致）
create or replace function public.bsync_admin_project_id()
returns uuid language sql immutable as $$
  select '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'::uuid;
$$;
comment on function public.bsync_admin_project_id() is
'bsync 租户在共享多租户体系中的 project_id；admin RPC 统一以此做成员校验，不接受前端传入';

-- 管理员断言：非成员直接抛错。所有 admin_* 函数第一行调用。
create or replace function public.assert_bsync_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_project_member(public.bsync_admin_project_id()) then
    raise exception 'forbidden: not a bsync admin';
  end if;
end;
$$;
comment on function public.assert_bsync_admin() is
'后台管理鉴权：当前 auth.uid() 必须在 project_members(bsync_project_id) 中，否则抛 forbidden';

-- ---------- 1) 审计表 ----------
create table if not exists public.bsync_admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid not null,
  action      text not null,           -- set_plan / reset_usage / set_license_active ...
  target_user uuid,                    -- 被操作的用户（可空）
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists bsync_admin_audit_admin_idx on public.bsync_admin_audit_log (admin_id, created_at desc);
create index if not exists bsync_admin_audit_target_idx on public.bsync_admin_audit_log (target_user, created_at desc);
comment on table public.bsync_admin_audit_log is
'后台管理操作审计：谁(admin_id)在何时(created_at)做了什么(action)改了谁(target_user)，detail 存改前/改后值';

alter table public.bsync_admin_audit_log enable row level security;
-- 审计表只读给管理员（通过 RPC 间接访问，不直接授权表级 select）
revoke all on table public.bsync_admin_audit_log from anon, authenticated;

-- ---------- 2) 鉴权与概览 ----------

-- 路由守卫用：返回 {is_admin, email}，非管理员不抛错
create or replace function public.admin_whoami()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return jsonb_build_object('is_admin', false, 'email', null);
  end if;
  select email into v_email from auth.users where id = v_uid;
  return jsonb_build_object(
    'is_admin', public.is_project_member(public.bsync_admin_project_id()),
    'email', v_email
  );
end;
$$;
comment on function public.admin_whoami() is
'返回当前登录用户是否为 bsync 管理员（供前端路由守卫）；非管理员不抛错';

-- 首页聚合指标
create or replace function public.admin_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total_users      bigint;
  v_new_today       bigint;
  v_new_7d          bigint;
  v_paid_users       bigint;
  v_active_dev_24h   bigint;
  v_orders_today     bigint;
  v_gmv_today_cents  bigint;
  v_oplog_rows       bigint;
  v_oplog_bytes      bigint;
  v_over_quota       bigint;
  v_daily_new        jsonb;
  v_daily_gmv        jsonb;
begin
  perform public.assert_bsync_admin();

  select count(*),
         count(*) filter (where created_at >= date_trunc('day', now())),
         count(*) filter (where created_at >= now() - interval '7 days')
    into v_total_users, v_new_today, v_new_7d
    from public.bsync_profiles;

  select count(*) into v_paid_users
    from public.bsync_profiles
   where plan in ('plus', 'pro', 'lifetime');

  select count(*) into v_active_dev_24h
    from public.bsync_devices
   where last_seen_at >= now() - interval '24 hours';

  select count(*), coalesce(sum(amount_cents), 0)
    into v_orders_today, v_gmv_today_cents
    from public.bsync_orders
   where status = 'paid' and created_at >= date_trunc('day', now());

  select count(*), coalesce(sum(pg_column_size(op)), 0)
    into v_oplog_rows, v_oplog_bytes
    from public.bsync_op_log;

  select count(*) into v_over_quota
    from public.bsync_profiles
   where used_bytes >= quota_bytes * 0.8 and quota_bytes > 0;

  -- 近 30 天每日新增用户
  select coalesce(jsonb_agg(jsonb_build_object('d', d::date, 'n', cnt) order by d), '[]'::jsonb)
    into v_daily_new
    from (
      select gs.d, count(p.user_id) as cnt
      from generate_series(current_date - interval '29 days', current_date, '1 day') as gs(d)
      left join public.bsync_profiles p on p.created_at::date = gs.d
      group by gs.d
    ) t;

  -- 近 30 天每日 GMV（cents）
  select coalesce(jsonb_agg(jsonb_build_object('d', d::date, 'cents', cents) order by d), '[]'::jsonb)
    into v_daily_gmv
    from (
      select gs.d, coalesce(sum(o.amount_cents), 0) as cents
      from generate_series(current_date - interval '29 days', current_date, '1 day') as gs(d)
      left join public.bsync_orders o
        on o.created_at::date = gs.d and o.status = 'paid'
      group by gs.d
    ) t;

  return jsonb_build_object(
    'total_users', v_total_users,
    'new_today', v_new_today,
    'new_7d', v_new_7d,
    'paid_users', v_paid_users,
    'paid_rate', case when v_total_users > 0 then round(v_paid_users::numeric / v_total_users, 4) else 0 end,
    'active_devices_24h', v_active_dev_24h,
    'orders_today', v_orders_today,
    'gmv_today_cents', v_gmv_today_cents,
    'oplog_rows', v_oplog_rows,
    'oplog_bytes', v_oplog_bytes,
    'over_quota_users', v_over_quota,
    'daily_new', v_daily_new,
    'daily_gmv_cents', v_daily_gmv
  );
end;
$$;
comment on function public.admin_overview() is
'后台首页聚合：用户/付费/活跃设备/今日订单/op_log 量 + 近30天新增与 GMV 趋势';

-- ---------- 3) 用户管理 ----------

create or replace function public.admin_list_users(
  p_search text default null,
  p_plan   text default null,
  p_sort   text default 'recent',   -- recent / usage / email
  p_limit  int  default 50,
  p_offset int  default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total bigint;
  v_rows  jsonb;
begin
  perform public.assert_bsync_admin();

  -- 总数
  select count(*) into v_total
    from public.bsync_profiles p
    join auth.users u on u.id = p.user_id
   where (p_search is null or u.email ilike '%' || p_search || '%')
     and (p_plan is null or p.plan = p_plan);

  -- 列表（聚合每用户的设备数/空间数）
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
    from (
      select p.user_id,
             u.email,
             p.plan,
             p.quota_bytes,
             p.used_bytes,
             p.used_count,
             p.purchased_at,
             p.created_at,
             (select count(*) from public.bsync_spaces s where s.owner_id = p.user_id) as space_count,
             (select count(distinct d.space_id) from public.bsync_devices d
                join public.bsync_spaces s2 on s2.id = d.space_id
               where s2.owner_id = p.user_id) as device_count,
             (select max(d.last_seen_at) from public.bsync_devices d
                join public.bsync_spaces s3 on s3.id = d.space_id
               where s3.owner_id = p.user_id) as last_seen_at
        from public.bsync_profiles p
        join auth.users u on u.id = p.user_id
       where (p_search is null or u.email ilike '%' || p_search || '%')
         and (p_plan is null or p.plan = p_plan)
       order by case when p_sort = 'usage'  then p.used_bytes end desc,
             case when p_sort = 'email'  then u.email end asc,
             case when p_sort = 'recent' then p.created_at end desc
       limit p_limit offset p_offset
    ) t;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;
comment on function public.admin_list_users(text, text, text, int, int) is
'后台用户列表：按邮箱模糊搜索 + plan 过滤 + 排序；返回每用户的设备数/空间数/最后活跃（聚合，不返回书签内容）';

create or replace function public.admin_get_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile record;
  v_sub     record;
  v_spaces  jsonb;
  v_devices jsonb;
  v_orders  jsonb;
  v_email   text;
begin
  perform public.assert_bsync_admin();

  select email into v_email from auth.users where id = p_user;
  select * into v_profile from public.bsync_profiles where user_id = p_user;
  select * into v_sub from public.bsync_subscriptions where user_id = p_user;

  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into v_spaces
    from (
      select s.id, s.name, s.is_default, s.created_at,
             (select count(*) from public.bsync_op_log o where o.space_id = s.id) as op_count,
             (select count(*) from public.bsync_devices d where d.space_id = s.id) as device_count
        from public.bsync_spaces s
       where s.owner_id = p_user
       order by s.is_default desc, s.created_at
    ) s;

  select coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) into v_devices
    from (
      select d.id, d.name, d.last_seen_at, s.name as space_name
        from public.bsync_devices d
        join public.bsync_spaces s on s.id = d.space_id
       where s.owner_id = p_user
       order by d.last_seen_at desc
       limit 50
    ) d;

  select coalesce(jsonb_agg(row_to_json(o)), '[]'::jsonb) into v_orders
    from (
      select id, plan, amount_cents, currency, status, creem_order_id, created_at
        from public.bsync_orders
       where user_id = p_user
       order by created_at desc
       limit 20
    ) o;

  return jsonb_build_object(
    'user_id', p_user,
    'email', v_email,
    'profile', row_to_json(v_profile),
    'subscription', case when v_sub.user_id is null then null else row_to_json(v_sub) end,
    'spaces', v_spaces,
    'devices', v_devices,
    'recent_orders', v_orders
  );
end;
$$;
comment on function public.admin_get_user(uuid) is
'后台用户详情：profile + 订阅 + 空间(含op_count) + 设备 + 最近20条订单；不含书签密文';

create or replace function public.admin_set_user_plan(p_user uuid, p_plan text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_new_quota bigint;
begin
  perform public.assert_bsync_admin();
  if p_plan not in ('free', 'plus', 'pro', 'lifetime') then
    raise exception 'invalid plan';
  end if;

  select plan into v_old from public.bsync_profiles where user_id = p_user;

  -- 配额与 plan 对齐（与 bsync_profiles 默认值/0013 折算一致）
  v_new_quota := case p_plan
    when 'free'     then 5 * 1024 * 1024      -- 5MB
    when 'plus'     then 50 * 1024 * 1024     -- 50MB（约 2.5 万条）
    when 'pro'      then 500 * 1024 * 1024    -- 500MB（约 25 万条）
    when 'lifetime' then 500 * 1024 * 1024
  end;

  update public.bsync_profiles
     set plan = p_plan, quota_bytes = v_new_quota, purchased_at = coalesce(purchased_at, now())
   where user_id = p_user;

  insert into public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  values (auth.uid(), 'set_plan', p_user,
          jsonb_build_object('old', v_old, 'new', p_plan, 'quota_bytes', v_new_quota));
end;
$$;
comment on function public.admin_set_user_plan(uuid, text) is
'后台手动改用户 plan（free/plus/pro/lifetime），同时对齐 quota_bytes；写审计日志';

create or replace function public.admin_reset_usage(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old_bytes bigint;
  v_old_count bigint;
begin
  perform public.assert_bsync_admin();
  select used_bytes, used_count into v_old_bytes, v_old_count
    from public.bsync_profiles where user_id = p_user;

  update public.bsync_profiles set used_bytes = 0, used_count = 0 where user_id = p_user;

  insert into public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  values (auth.uid(), 'reset_usage', p_user,
          jsonb_build_object('old_used_bytes', v_old_bytes, 'old_used_count', v_old_count));
end;
$$;
comment on function public.admin_reset_usage(uuid) is
'后台清零用户 used_bytes/used_count（客服补偿场景）；写审计日志';

-- ---------- 4) 订单与订阅 ----------

create or replace function public.admin_list_orders(
  p_status text default null,
  p_plan   text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total bigint;
  v_rows  jsonb;
begin
  perform public.assert_bsync_admin();

  select count(*) into v_total from public.bsync_orders o
   where (p_status is null or o.status = p_status)
     and (p_plan is null or o.plan = p_plan);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
    from (
      select o.id, o.user_id, u.email, o.plan, o.amount_cents, o.currency,
             o.status, o.creem_order_id, o.creem_subscription_id, o.created_at
        from public.bsync_orders o
        left join auth.users u on u.id = o.user_id
       where (p_status is null or o.status = p_status)
         and (p_plan is null or o.plan = p_plan)
       order by o.created_at desc
       limit p_limit offset p_offset
    ) t;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;
comment on function public.admin_list_orders(text, text, int, int) is
'后台订单流水：按状态/plan 过滤 + 分页；join auth.users 带邮箱';

create or replace function public.admin_list_subscriptions(p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_bsync_admin();
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select s.user_id, u.email, s.plan, s.status,
             s.creem_customer_id, s.current_period_end, s.canceled_at,
             s.created_at, s.updated_at
        from public.bsync_subscriptions s
        left join auth.users u on u.id = s.user_id
       where (p_status is null or s.status = p_status)
       order by
         case when s.status = 'active' then 0 else 1 end,
         s.updated_at desc
    ) t
  ), '[]'::jsonb);
end;
$$;
comment on function public.admin_list_subscriptions(text) is
'后台订阅列表：active 排前，按最近更新排序；可按状态过滤';

-- ---------- 5) License / Token ----------

create or replace function public.admin_list_licenses(
  p_active boolean default null,
  p_limit  int     default 50,
  p_offset int     default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total bigint;
  v_rows  jsonb;
begin
  perform public.assert_bsync_admin();

  select count(*) into v_total from public.lic_licenses l
   where l.project_id = public.bsync_admin_project_id()
     and (p_active is null or l.is_active = p_active);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
    from (
      select id, license_key, expire_date, is_active, max_usage, used_count,
             created_at, last_used_at
        from public.lic_licenses l
       where l.project_id = public.bsync_admin_project_id()
         and (p_active is null or l.is_active = p_active)
       order by created_at desc
       limit p_limit offset p_offset
    ) t;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;
comment on function public.admin_list_licenses(boolean, int, int) is
'后台 License 卡列表（bsync 项目）；license_key 原样返回仅管理员可见';

create or replace function public.admin_set_license_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old boolean;
begin
  perform public.assert_bsync_admin();
  select is_active into v_old from public.lic_licenses
   where id = p_id and project_id = public.bsync_admin_project_id();

  update public.lic_licenses set is_active = p_active
   where id = p_id and project_id = public.bsync_admin_project_id();

  insert into public.bsync_admin_audit_log (admin_id, action, detail)
  values (auth.uid(), 'set_license_active', null,
          jsonb_build_object('license_id', p_id, 'old', v_old, 'new', p_active));
end;
$$;
comment on function public.admin_set_license_active(uuid, boolean) is
'后台启用/停用 License 卡；写审计日志';

-- ---------- 6) 系统监控 ----------

create or replace function public.admin_system_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_oplog_rows      bigint;
  v_oplog_bytes     bigint;
  v_snapshot_count  bigint;
  v_top_users       jsonb;
  v_recent_gc       timestamptz;
begin
  perform public.assert_bsync_admin();

  select count(*), coalesce(sum(pg_column_size(op)), 0)
    into v_oplog_rows, v_oplog_bytes
    from public.bsync_op_log;

  select count(*) into v_snapshot_count from public.bsync_snapshots;

  -- 最近一次快照时间（GC 是否在跑）
  select max(created_at) into v_recent_gc from (
    select s.created_at from public.bsync_snapshots s order by s.id desc limit 1
  ) t;

  -- op_log 占用 Top 10 用户（按 owner_id 聚合，不 select op 内容）
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_top_users
    from (
      select sp.owner_id as user_id, u.email,
             count(o.id) as oplog_rows,
             coalesce(sum(pg_column_size(o.op)), 0) as oplog_bytes
        from public.bsync_op_log o
        join public.bsync_spaces sp on sp.id = o.space_id
        left join auth.users u on u.id = sp.owner_id
       group by sp.owner_id, u.email
       order by oplog_bytes desc
       limit 10
    ) t;

  return jsonb_build_object(
    'oplog_rows', v_oplog_rows,
    'oplog_bytes', v_oplog_bytes,
    'snapshot_count', v_snapshot_count,
    'latest_snapshot_at', v_recent_gc,
    'top_users', v_top_users
  );
end;
$$;
comment on function public.admin_system_stats() is
'系统监控：op_log 总量/字节、快照数、最近 GC 时间、op_log 占用 Top10 用户（仅元数据，不解密）';

-- ---------- 7) 授权 ----------
-- 所有 admin_* 函数只允许 authenticated 调用，且函数体内部再做管理员断言
revoke all on function public.admin_whoami()                       from anon;
revoke all on function public.admin_overview()                     from anon;
revoke all on function public.admin_list_users(text,text,text,int,int) from anon;
revoke all on function public.admin_get_user(uuid)                from anon;
revoke all on function public.admin_set_user_plan(uuid,text)       from anon;
revoke all on function public.admin_reset_usage(uuid)             from anon;
revoke all on function public.admin_list_orders(text,text,int,int) from anon;
revoke all on function public.admin_list_subscriptions(text)      from anon;
revoke all on function public.admin_list_licenses(boolean,int,int) from anon;
revoke all on function public.admin_set_license_active(uuid,boolean) from anon;
revoke all on function public.admin_system_stats()                from anon;

grant execute on function public.admin_whoami()                       to authenticated;
grant execute on function public.admin_overview()                     to authenticated;
grant execute on function public.admin_list_users(text,text,text,int,int) to authenticated;
grant execute on function public.admin_get_user(uuid)                to authenticated;
grant execute on function public.admin_set_user_plan(uuid,text)       to authenticated;
grant execute on function public.admin_reset_usage(uuid)             to authenticated;
grant execute on function public.admin_list_orders(text,text,int,int) to authenticated;
grant execute on function public.admin_list_subscriptions(text)      to authenticated;
grant execute on function public.admin_list_licenses(boolean,int,int) to authenticated;
grant execute on function public.admin_set_license_active(uuid,boolean) to authenticated;
grant execute on function public.admin_system_stats()                to authenticated;
