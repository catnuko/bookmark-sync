-- 删除墓碑 + 并集合并（替换"先拉后推镜像"方案）
-- 目的：并发变更真正合并 —— 删除靠墓碑传播（不会复活），新增靠并集保留（不会被吞）
-- 在 Supabase Dashboard 的 SQL Editor 中执行，或在本地 `supabase db push`。
--
-- 设计：
--   1. bsync_tombstones：用户删除过的 URL 集合（带来源 device），RLS 隔离
--   2. bsync_snapshot_push(p_data, p_tombstones, p_device)：
--      - 本设备重新推送某 URL（本地重新添加）→ 清除自己拥有的墓碑（重加优先）
--      - 其余墓碑对快照做过滤 → 被任何设备删除过的 URL 不会再次出现
--   3. bsync_snapshot_pull()：返回最新快照 + 墓碑列表（客户端据此清理本地残留）

-- ============================================================
-- 墓碑表
-- ============================================================

create table if not exists public.bsync_tombstones (
    user_id    uuid   not null references auth.users (id) on delete cascade,
    url        text   not null,
    device     text   not null default '',          -- 删除来源设备（owner 重加时清除自己的墓碑）
    created_at timestamptz not null default now(),
    primary key (user_id, url)
);

create index if not exists bsync_tombstones_user_idx
    on public.bsync_tombstones (user_id, created_at desc);

alter table public.bsync_tombstones enable row level security;

drop policy if exists bsync_own_tombstones on public.bsync_tombstones;
create policy bsync_own_tombstones on public.bsync_tombstones
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

revoke all on table public.bsync_tombstones from anon;
grant select, insert, delete on table public.bsync_tombstones to authenticated;

-- ============================================================
-- 1. bsync_snapshot_push：推送快照（含配额检查 + 墓碑合并）
-- ============================================================

drop function if exists public.bsync_snapshot_push(jsonb) cascade;

-- 内部记账：更新 used_bytes（security definer，绕过 RLS）
-- 不用放开 authenticated 对 profiles 的 update 权限（避免自改 plan）
create or replace function public.bsync_touch_used(p_user uuid, p_size bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- 只能改自己的 used_bytes（防客户端直接调用越权改他人）
    if auth.uid() is distinct from p_user then
        raise exception 'not allowed';
    end if;
    update public.bsync_profiles
       set used_bytes = p_size
     where user_id = p_user;
end;
$$;

create or replace function public.bsync_snapshot_push(p_data jsonb, p_tombstones jsonb default '[]'::jsonb, p_device text default '')
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user    uuid;
    v_size    bigint;
    v_profile record;
    v_url     text;
    v_tomb    record;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 1) 本设备重新推送的 URL：若存在自己拥有的墓碑，视为"重新添加"，清除墓碑
    for v_url in
        select distinct b->>'url' as url
        from jsonb_array_elements(p_data) as b
    loop
        delete from public.bsync_tombstones
         where user_id = v_user and url = v_url and device = p_device;
    end loop;

    -- 2) 合并本次推送的墓碑（owner = 本设备）
    --    若某 URL 同时被本设备重新推送（本地重新添加）→ 视为重加获胜，跳过墓碑；
    --    已存在的墓碑保留原 owner（首写者获胜），避免他人同步驱动的删除篡改归属
    for v_tomb in
        select jsonb_array_elements_text(p_tombstones) as url
    loop
        if exists (
            select 1 from jsonb_array_elements(p_data) as b
            where b->>'url' = v_tomb.url
        ) then
            continue;
        end if;
        insert into public.bsync_tombstones (user_id, url, device)
        values (v_user, v_tomb.url, p_device)
        on conflict (user_id, url) do nothing;
    end loop;

    -- 3) 配额检查（只看过滤后的快照大小）
    perform public.bsync_ensure_profile(v_user);
    select * into v_profile from public.bsync_profiles where user_id = v_user;

    v_size := octet_length(coalesce((
        select jsonb_agg(b) from (
            select b
            from jsonb_array_elements(p_data) as b
            where b->>'url' not in (
                select url from public.bsync_tombstones where user_id = v_user
            )
        ) t
    ), '[]'::jsonb)::text);
    if v_size > v_profile.quota_bytes then
        raise exception 'quota_exceeded';
    end if;

    -- 4) 写入过滤后的快照（被删除过的 URL 不会再次出现）
    insert into public.bsync_snapshots (user_id, data)
    select v_user, coalesce(jsonb_agg(b), '[]'::jsonb)
    from (
        select b
        from jsonb_array_elements(p_data) as b
        where b->>'url' not in (
            select url from public.bsync_tombstones where user_id = v_user
        )
    ) t;

    -- 5) 更新 used_bytes（security definer 记账）
    perform public.bsync_touch_used(v_user, v_size);

    -- 6) 墓碑上限：每用户保留最新 2000 条，防止无限增长
    delete from public.bsync_tombstones t
    where t.user_id = v_user
      and t.created_at < (
          select min(created_at) from (
              select created_at from public.bsync_tombstones
               where user_id = v_user
               order by created_at desc
               limit 2000
          ) s
      );

    return jsonb_build_object(
        'ok', true,
        'size', v_size,
        'quota', v_profile.quota_bytes,
        'plan', v_profile.plan
    );
end;
$$;

-- ============================================================
-- 2. bsync_snapshot_pull：拉取最新快照 + 墓碑列表
-- ============================================================

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
     order by created_at desc
     limit 1;

    return jsonb_build_object(
        'bookmarks', coalesce(v_data, '[]'::jsonb),
        'tombstones', coalesce((
            select jsonb_agg(url order by created_at desc)
            from public.bsync_tombstones
            where user_id = v_user
        ), '[]'::jsonb)
    );
end;
$$;

-- ============================================================
-- 权限收紧
-- ============================================================

revoke all on function public.bsync_snapshot_push(jsonb, jsonb, text) from public;
revoke all on function public.bsync_snapshot_pull() from public;
revoke all on function public.bsync_touch_used(uuid, bigint) from public;

grant execute on function public.bsync_snapshot_push(jsonb, jsonb, text) to authenticated;
grant execute on function public.bsync_snapshot_pull() to authenticated;
-- bsync_touch_used 仅由 bsync_snapshot_push 内部调用（definer 上下文），不授给客户端
