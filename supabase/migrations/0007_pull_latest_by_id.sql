-- 修复：bsync_snapshot_pull() 取"最新快照"的顺序键
--
-- 原实现 `order by created_at desc limit 1`。created_at 默认 now()，即 *事务开始时间*：
-- 同一事务内写入的多份快照时间戳完全相同，排序结果不确定 → 可能取到旧快照。
-- （生产上每次 RPC 是独立事务，碰不到；但同一事务内推送两次会踩到，且语义上不应依赖。）
--
-- id 是 `generated always as identity`，严格按插入顺序递增 → 用 id desc 才是确定的"最新"。
-- created_at desc 保留为同等条件下的可读顺序；listSnapshots 仍按 created_at 展示。

create or replace function public.bsync_snapshot_pull()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user uuid;
    v_data jsonb;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    select data into v_data
      from public.bsync_snapshots
     where user_id = v_user
     order by id desc
     limit 1;

    return jsonb_build_object(
        'bookmarks', coalesce(v_data, '[]'::jsonb),
        'tombstones', coalesce((
            select jsonb_agg(url order by created_at desc, url)
            from public.bsync_tombstones
            where user_id = v_user
        ), '[]'::jsonb)
    );
end;
$$;

revoke all on function public.bsync_snapshot_pull() from public;
revoke execute on function public.bsync_snapshot_pull() from anon;
grant execute on function public.bsync_snapshot_pull() to authenticated;
