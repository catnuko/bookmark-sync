-- ============================================================================
-- 0051 admin_list_users_device_labels.sql — 用户列表直接给出「浏览器 · 系统 · 版本」
-- 日期：2026-10-20
--
-- 需求：后台用户列表要一眼看出「谁在用什么系统上的哪个浏览器、跑到哪个版本」。
--   0050 已把版本写进 bsync_devices.app_version，但列表页（admin_list_users）
--   只返回 device_count，看不到明细。
--
-- 变更：admin_list_users 的每行增 `device_labels`（jsonb 数组，字符串元素），
--   形如 ["Edge · Windows · 2.10.1", "Firefox · Windows · 2.10.0"]。
--   · 拼接在 SQL 里做，前端直接渲染，避免前后端各写一份格式化逻辑；
--   · 版本为空（存量设备尚未心跳）时显示 "浏览器 · 系统 · (版本未知)"，
--     而不是把空值拼成 "Edge · Windows · "；
--   · 按 last_seen_at 倒序，最多 10 台（列表页是概览，详情页才有完整列表）。
--   · 其余字段（device_count / space_count / last_seen_at / 排序 / 分页）不变。
--
-- 幂等性：CREATE OR REPLACE，可安全重放；不新建表、不动 RLS、不重新 grant。
-- 范围：仅重定义 public.admin_list_users。
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

  -- 列表（聚合每用户的设备数/空间数/设备版本标签）
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
               where s3.owner_id = p.user_id) as last_seen_at,
             -- 0051：设备标签「浏览器 · 系统 · 版本」，按最近活跃倒序，最多 10 台
             (select coalesce(jsonb_agg(lbl order by seen desc), '[]'::jsonb)
                from (
                  select (d.name || ' · ' ||
                          coalesce(nullif(btrim(d.app_version), ''), '(版本未知)')) as lbl,
                         d.last_seen_at as seen
                    from public.bsync_devices d
                    join public.bsync_spaces s4 on s4.id = d.space_id
                   where s4.owner_id = p.user_id
                   order by d.last_seen_at desc
                   limit 10
                ) l) as device_labels
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
'后台用户列表：按邮箱模糊搜索 + plan 过滤 + 排序；返回每用户的设备台数/空间数/最后活跃/设备版本标签（聚合，不返回书签内容）。device_count 为设备行数 count(*)（0049）；device_labels 形如 ["Edge · Windows · 2.10.1"]（0051）。';
