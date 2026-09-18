-- 0015 修复 push 配额计算崩溃：octet_length(jsonb) 不存在
-- ------------------------------------------------------------------
-- 问题（v1.1.0 回归，阻断级：所有设备的书签同步 100% 失败）：
--   0014 里 push 函数计算用户总量配额时写了 `octet_length(ranked.data)`，
--   其中 bsync_snapshots.data 是 jsonb 列。PostgreSQL 的 octet_length
--   只接受 text/bytea，没有 jsonb 重载 → 执行到此处抛 42883
--   (function octet_length(jsonb) does not exist) → PostgREST 映射为
--   HTTP 404 → 前端只看到 "rpc_error"，极易误判为函数未部署。
--
--   同函数 425 行的 v_size 计算写法正确（octet_length(... ::text)），
--   0004/0005/0012 的历史版本也均带 ::text，唯独 0014 的 v_total 漏了。
--
-- 修复：仅把该处改为 octet_length(ranked.data::text)。
--   签名不变 → create or replace 即可，权限（grant/revoke）随 OID 保留。
--   函数为 plpgsql 单事务：此前所有失败的推送均已原子回滚，无脏数据。
-- ------------------------------------------------------------------

create or replace function public.bsync_snapshot_push(
    p_data        jsonb,
    p_tombstones  jsonb default '[]'::jsonb,
    p_device      text default '',
    p_space       uuid default null,
    p_device_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user    uuid;
    v_space   uuid;
    v_size    bigint;
    v_total   bigint;
    v_profile record;
    v_sync_id text;
    v_tomb    record;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 解析空间：未指定 → 默认空间（惰性创建，兼容老客户端）
    if p_space is null then
        select id into v_space
          from public.bsync_spaces
         where user_id = v_user and is_default
         limit 1;
        if v_space is null then
            insert into public.bsync_spaces (user_id, name, is_default)
            values (v_user, '默认空间', true)
            on conflict (user_id) where is_default do nothing
            returning id into v_space;
        end if;
        if v_space is null then
            select id into v_space
              from public.bsync_spaces
             where user_id = v_user and is_default
             limit 1;
        end if;
    else
        select id into v_space
          from public.bsync_spaces
         where id = p_space and user_id = v_user;
        if v_space is null then
            raise exception 'space_not_found';
        end if;
    end if;

    -- 串行化同一 (用户, 空间) 的推送，多空间互不阻塞（沿用 99887766 lock 家族）
    perform pg_advisory_xact_lock(99887766, hashtext(v_user::text || ':' || v_space::text));

    -- 1) 重加获胜：本设备推回自己此前删除过的 sync_id → 清除自己的墓碑（限本空间）
    for v_sync_id in
        select distinct trim(b->>'sync_id') as sync_id
        from jsonb_array_elements(p_data) as b
        where nullif(b->>'sync_id', '') is not null
    loop
        delete from public.bsync_tombstones
         where user_id = v_user and space_id = v_space
           and sync_id = v_sync_id and device = p_device;
    end loop;

    -- 2) 合并本次推送的墓碑（owner = 本设备；首写者获胜）
    for v_tomb in
        select *
        from jsonb_to_recordset(p_tombstones::jsonb) as t(sync_id text, url text)
    loop
        if exists (
            select 1 from jsonb_array_elements(p_data) as b
            where b->>'sync_id' = v_tomb.sync_id
        ) then
            continue;
        end if;
        insert into public.bsync_tombstones (user_id, space_id, sync_id, url, device)
        values (v_user, v_space, v_tomb.sync_id, coalesce(v_tomb.url, ''), p_device)
        on conflict (user_id, space_id, sync_id) do nothing;
    end loop;

    perform public.bsync_ensure_profile(v_user);
    select * into v_profile from public.bsync_profiles where user_id = v_user;

    -- 3) 写入过滤后的快照（本空间墓碑过滤；被删除过的 sync_id 不会再次出现）
    insert into public.bsync_snapshots (user_id, space_id, data)
    select v_user, v_space, coalesce(jsonb_agg(b), '[]'::jsonb)
    from (
        select b
        from jsonb_array_elements(p_data) as b
        where b->>'sync_id' not in (
            select sync_id from public.bsync_tombstones
             where user_id = v_user and space_id = v_space
        )
    ) t;

    -- 4) 配额：按用户总量计 = 各空间最新快照大小之和（本次 insert 后计算，
    --    超额抛错回滚整个推送，含墓碑合并）
    v_size := octet_length(coalesce((
        select jsonb_agg(b) from (
            select b
            from jsonb_array_elements(p_data) as b
            where b->>'sync_id' not in (
                select sync_id from public.bsync_tombstones
                 where user_id = v_user and space_id = v_space
            )
        ) t
    ), '[]'::jsonb)::text);

    v_total := coalesce((
        select sum(latest.sz)
        from (
            select octet_length(ranked.data::text) as sz
            from (
                select data,
                       row_number() over (partition by space_id order by created_at desc) as rn
                from public.bsync_snapshots
                 where user_id = v_user
            ) ranked
            where ranked.rn = 1
        ) latest
    ), 0);

    if v_total > v_profile.quota_bytes then
        raise exception 'quota_exceeded';
    end if;

    -- 5) 记账（definer，security invoker 环境下正常工作）
    perform public.bsync_touch_used(v_user, v_total);

    -- 6) 设备登记 / 刷新（definer 绕过 bsync_devices 无 insert 授权）
    perform public.bsync_device_touch(p_device, p_device_name, v_space);

    -- 7) 墓碑上限：每空间保留最新 2000 条
    delete from public.bsync_tombstones t
    where t.user_id = v_user
      and t.space_id = v_space
      and t.created_at < (
          select min(created_at) from (
              select created_at from public.bsync_tombstones
               where user_id = v_user and space_id = v_space
               order by created_at desc
               limit 2000
          ) s
      );

    return jsonb_build_object(
        'ok', true,
        'size', v_size,
        'total', v_total,
        'quota', v_profile.quota_bytes,
        'plan', v_profile.plan,
        'space_id', v_space
    );
end;
$$;
