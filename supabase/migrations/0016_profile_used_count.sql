-- 0016 bsync_get_profile 增加书签条数（前端按「条」展示额度）
-- 背景：定价口径为条数（官网：Free 500 条 / Plus 10,000 条 / Pro 不限），
--       扩展配额卡原展示 MB（used_bytes/quota_bytes），用户无法对照定价理解额度。
--       引擎执行口径不变（仍按 quota_bytes，见 0013 的折算留量），本迁移只补展示数据。
--
-- used_count 口径 = 各空间「最新一条快照」中 type='bookmark' 节点数之和，
-- 与 push 的 v_total（used_bytes）同口径：只算各空间最新快照，历史快照不计。

create or replace function public.bsync_get_profile()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user uuid;
    v_profile record;
    v_used_count bigint;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    perform public.bsync_ensure_profile(v_user);

    select plan, quota_bytes, used_bytes, purchased_at
      into v_profile
      from public.bsync_profiles
     where user_id = v_user;

    -- 各空间最新快照的书签节点数求和（RLS：invoker 只能读到自己的快照）
    select coalesce(sum(latest.cnt), 0) into v_used_count
    from (
        select (
            select count(*)
            from jsonb_array_elements(ranked.data) as n
            where n->>'type' = 'bookmark'
        ) as cnt
        from (
            select data,
                   row_number() over (partition by space_id order by created_at desc) as rn
            from public.bsync_snapshots
            where user_id = v_user
        ) ranked
        where ranked.rn = 1
    ) latest;

    return jsonb_build_object(
        'plan', v_profile.plan,
        'quota_bytes', v_profile.quota_bytes,
        'used_bytes', v_profile.used_bytes,
        'used_count', v_used_count,
        'purchased_at', v_profile.purchased_at
    );
end;
$$;

revoke all on function public.bsync_get_profile() from public;
grant execute on function public.bsync_get_profile() to authenticated;

comment on function public.bsync_get_profile() is
'返回当前用户档案：plan / quota_bytes / used_bytes / used_count（各空间最新快照书签条数之和）/ purchased_at。';
