-- ============================================================================
-- 0049 fix_admin_list_users_device_count.sql — 后台用户列表「设备数」口径修正
-- 日期：2026-10-20
--
-- 问题：admin_list_users 的 device_count 写成 count(distinct d.space_id)，
--   统计的是「该用户名下出现过设备的**不同空间**个数」，不是设备台数。
--   表现为：同一用户的两台设备都绑在默认空间时，列表页恒显示 1，
--   而详情页（按空间 count(*) + 设备列表）正确显示 2。
--
-- 由来：0038 时期主键是复合 (space_id, id)，同一台设备可在多个空间各占一行，
--   用 count(*) 会重复计数，于是加了去重 —— 但去重键选错了，应按 d.id 去重。
--   0039 已把主键改回单列 id（一台设备一行），本应顺手修正此表达式，
--   但 0039 文件头误判「0020 的管理端统计不改（按 space_id 聚合仍正确）」，
--   这句对详情页成立、对列表页不成立，故遗留至今。
--
-- 修正：改为 count(*)（0039 之后一台设备一行，无需去重）。
--   与设备上限校验（0033/0039 的 count(*)）、详情页设备列表口径保持一致。
--
-- 范围：仅重定义 public.admin_list_users 一个函数，其余 8 个返回字段
--   （user_id/email/plan/quota_bytes/used_bytes/used_count/purchased_at/
--   created_at/space_count/last_seen_at）语义一律不变。
-- 幂等性：CREATE OR REPLACE，可安全重放；不新建表、不动 RLS、不重新 grant
--   （CREATE OR REPLACE 保留原有 ACL，0020 已 grant execute to authenticated）。
-- ============================================================================

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
             -- 0049：设备台数（一台设备一行）。原 count(distinct d.space_id)
             -- 数的是空间数，同空间多设备会被压成 1。
             (select count(*) from public.bsync_devices d
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
'后台用户列表：按邮箱模糊搜索 + plan 过滤 + 排序；返回每用户的设备台数/空间数/最后活跃（聚合，不返回书签内容）。device_count 为设备行数 count(*)（0049 修正：原 count(distinct space_id) 统计的是空间数）';
