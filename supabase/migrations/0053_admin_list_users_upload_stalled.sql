-- ============================================================================
-- 0053 admin_list_users_upload_stalled.sql — 用户列表标出「有书签但云盘是空」
-- 日期：2026-10-22
--
-- 背景（2026-10-22 排查 xyun0691@gmail.com）：
--   该账号 2,828 条、用量 0 B。原因是两条完全独立的路径：
--     · used_count 由客户端 `bsync_profile_set_used` 直接上报本机条数（0018），
--       无条件写入 —— 所以条数看着正常；
--     · used_bytes 由服务端聚合 op_log.op + snapshots.data 的字节（0032），
--       而这用户的 op_log 是 0 行 → 恒为 0。
--   0 行的根因是客户端免费档条数闸门（src/sync/syncEngine.ts flushPush）：
--   可见条数 > 1,000 时只放行删除类 op，首次上传全是创建 op，一条都上不去。
--   于是「界面显示已同步、云端其实一条都没有」，后台表格里两列并排却读不出异常。
--
-- 变更：admin_list_users 每行增 `upload_stalled`（boolean）与 `op_count`（bigint）。
--   upload_stalled = used_count > 0 且该用户 op_log 行数 = 0 且无快照。
--   · 这正是「本机有 N 条，云端空」的判定式：条数报上来了（客户端跑过），
--     但服务端一条密文都没收到。
--   · op_count 一并返回，便于区分「一条没传」与「传过但被 GC 截断成快照」。
--   · 其余字段（用量/档位/设备/空间/排序/分页）不变。
--
-- 语义边界：upload_stalled 只描述「当前云盘为空」这一客观状态，不推断原因
--   （条数闸门 / 网络长期不通 / 用户刚清空云端都可能命中），原因是给运维的线索，
--   不是给用户的判据。空账号（used_count = 0）不算 stalled。
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

  -- 列表（聚合每用户的设备数/空间数/设备版本标签/云端 op 行数）
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
                ) l) as device_labels,
             -- 0053：云端实际收到的 op 行数（与 0032 的 used_bytes 同口径来源）
             (select count(*) from public.bsync_op_log o
                join public.bsync_spaces s5 on s5.id = o.space_id
               where s5.owner_id = p.user_id) as op_count,
             -- 0053：「本机有书签，云端一条密文都没有」
             coalesce(
               p.used_count > 0
               and not exists (
                 select 1 from public.bsync_op_log o
                   join public.bsync_spaces s6 on s6.id = o.space_id
                  where s6.owner_id = p.user_id
               )
               and not exists (
                 select 1 from public.bsync_snapshots sn
                   join public.bsync_spaces s7 on s7.id = sn.space_id
                  where s7.owner_id = p.user_id
               ),
               false
             ) as upload_stalled
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
'后台用户列表：按邮箱模糊搜索 + plan 过滤 + 排序；返回每用户的设备台数/空间数/最后活跃/设备版本标签/云端 op 行数（聚合，不返回书签内容）。device_count 为设备行数 count(*)（0049）；device_labels 形如 ["Edge · Windows · 2.10.1"]（0051）；upload_stalled = 有 used_count 但 op_log 与快照均为空（0053）。';
