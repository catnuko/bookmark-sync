-- ============================================================================
-- 0047 device_breakdown.sql — admin_overview() 增补「按设备名聚合的设备台数」
-- 日期：2026-10-15
--
-- 背景：后台首页（website/ /admin）只有 active_devices_24h 一个设备指标，看不出
--   用户实际用的设备/浏览器分布。bsync_devices 里没有 OS/浏览器/平台列，唯一可用
--   的维度是 name —— 客户端从 UA 探测生成的字符串（形如 "Chrome · macOS"、
--   "Edge · Windows"、"浏览器"，见 src/sync.ts detectDeviceName），且可被用户
--   手动改名（bsync_device_rename，迁移 0031）。因此本聚合是**尽力而为**的口径，
--   不保证 name 取值规范。
--
-- 行为：在 0020 版 admin_overview() 基础上**纯增量**新增一个返回 key：
--   · 'devices' —— 形如 [{"name":"Chrome · macOS","n":12}, ...] 的数组，
--     按台数 n 降序，最多 50 组；无数据时 '[]'::jsonb。
--   · 其余 13 个 key（total_users/new_today/new_7d/paid_users/paid_rate/
--     active_devices_24h/orders_today/gmv_today_cents/oplog_rows/oplog_bytes/
--     over_quota_users/daily_new/daily_gmv_cents）名字与语义**一律不变**。
--
-- 「近 30 天活跃」口径：统计窗口取 last_seen_at >= now() - interval '30 days'。
--   与 0020 的 active_devices_24h（24 小时窗口）刻意区分 —— 24 小时太短，冷启动
--   用户会整批消失，看不出分布；30 天与首页「近 30 天新增/GMV 趋势」的窗口对齐，
--   只纳入近期真正在用的设备，避免把早已弃用的历史设备混进分布。
--
-- 幂等性：CREATE OR REPLACE，可安全重放。
-- 范围：仅重定义 public.admin_overview() 一个函数，不新建表、不动 RLS、不碰其他
--   函数；不重新 grant/revoke（CREATE OR REPLACE 保留原有 ACL，0020 已 grant
--   execute to authenticated）。
-- ============================================================================

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
  v_devices          jsonb;
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

  -- 按设备名聚合的设备台数（仅近 30 天活跃设备，见文件头口径说明）
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc), '[]'::jsonb)
    into v_devices
    from (
      select name, count(*) as n
        from public.bsync_devices
       where last_seen_at >= now() - interval '30 days'
       group by name
       order by n desc
       limit 50
    ) t;

  return jsonb_build_object(
    'total_users', v_total_users,
    'new_today', v_new_today,
    'new_7d', v_new_7d,
    'paid_users', v_paid_users,
    'paid_rate', case when v_total_users > 0 then round(v_paid_users::numeric / v_total_users, 4) else 0 end,
    'active_devices_24h', v_active_dev_24h,
    'devices', v_devices,
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
