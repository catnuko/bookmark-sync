-- ============================================================
-- 0012: 真树 + sync_id 同步模型
-- ------------------------------------------------------------
-- 目标：解决扁平 URL 方案的三个硬伤
--   1. 同 URL 多文件夹   → 主键从 url 改为客户端生成的 sync_id（ULID）
--   2. 文件夹改名/移动丢子项 → 快照改为扁平节点数组 + parent_sync_id 真树语义
--   3. 删除复活          → 墓碑按 sync_id 记录，具备粘性删除
--   本次同时引入 updated_at（LWW 冲突解决）与 order（同级排序）。
--
-- 服务端职责：权威存储 + 粘性墓碑（读时过滤），不做复杂合并在服务端。
-- 三方合并/LWW/真树编码在客户端（扩展）完成。旧快照数据（folder 路径扁平
-- 结构）与新格式不兼容，故清空历史快照，从新格式重新开始。
--
-- 注意：本迁移会 DROP 旧墓碑表并重建，旧扁平快照一并清空。用户已有书签
-- 会在首次同步时由客户端以新格式重新推送。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 墓碑表：主键从 (user_id, url) 改为 (user_id, sync_id)
-- ------------------------------------------------------------
drop table if exists public.bsync_tombstones cascade;

create table public.bsync_tombstones (
    user_id    uuid   not null references auth.users (id) on delete cascade,
    sync_id    text   not null,                  -- 客户端稳定 ID（ULID），删除标记的主体
    url        text   not null default '',       -- 冗余保留，便于排查 / GC（不参与定位）
    device     text   not null default '',       -- 删除来源设备（owner 重加时清除自己的墓碑）
    created_at timestamptz not null default now(),
    primary key (user_id, sync_id)
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

-- ------------------------------------------------------------
-- 2. 清空旧快照（folder 扁平结构与新格式不兼容，无法无损迁移）
-- ------------------------------------------------------------
delete from public.bsync_snapshots;

-- ------------------------------------------------------------
-- 3. bsync_snapshot_push：推送（配额 + 墓碑粘性过滤）
-- ------------------------------------------------------------
drop function if exists public.bsync_snapshot_push(jsonb, jsonb, text) cascade;

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
    v_sync_id text;
    v_tomb    record;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 串行化整个推送，避免多设备并发 push 互相覆盖（沿用 0001 的 advisory lock key）
    perform pg_advisory_xact_lock(99887766);

    -- 1) 本设备本次推送携带的 sync_id：若服务端已有该 id 的墓碑且 owner = 本设备，
    --    视为"重新添加"，清除墓碑（重加获胜，仅限原删除设备）
    for v_sync_id in
        select distinct trim(b->>'sync_id') as sync_id
        from jsonb_array_elements(p_data) as b
        where nullif(b->>'sync_id', '') is not null
    loop
        delete from public.bsync_tombstones
         where user_id = v_user and sync_id = v_sync_id and device = p_device;
    end loop;

    -- 2) 合并本次推送的墓碑（owner = 本设备）
    --    若某 sync_id 被本设备同批推送（本地重新添加）→ 视为重加获胜，跳过墓碑；
    --    已存在的墓碑保留原 owner（首写者获胜），避免他人同步驱动的删除篡改归属
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
        insert into public.bsync_tombstones (user_id, sync_id, url, device)
        values (v_user, v_tomb.sync_id, coalesce(v_tomb.url, ''), p_device)
        on conflict (user_id, sync_id) do nothing;
    end loop;

    -- 3) 配额检查（只看过滤后的快照大小 = 不含已删除 sync_id 的节点）
    perform public.bsync_ensure_profile(v_user);
    select * into v_profile from public.bsync_profiles where user_id = v_user;

    v_size := octet_length(coalesce((
        select jsonb_agg(b) from (
            select b
            from jsonb_array_elements(p_data) as b
            where b->>'sync_id' not in (
                select sync_id from public.bsync_tombstones where user_id = v_user
            )
        ) t
    ), '[]'::jsonb)::text);
    if v_size > v_profile.quota_bytes then
        raise exception 'quota_exceeded';
    end if;

    -- 4) 写入过滤后的快照（被删除过的 sync_id 不会再次出现）
    insert into public.bsync_snapshots (user_id, data)
    select v_user, coalesce(jsonb_agg(b), '[]'::jsonb)
    from (
        select b
        from jsonb_array_elements(p_data) as b
        where b->>'sync_id' not in (
            select sync_id from public.bsync_tombstones where user_id = v_user
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

-- ------------------------------------------------------------
-- 4. bsync_snapshot_pull：拉取最新快照 + 墓碑列表
-- ------------------------------------------------------------
drop function if exists public.bsync_snapshot_pull() cascade;

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
            select jsonb_agg(jsonb_build_object('sync_id', sync_id, 'url', url) order by created_at desc)
            from public.bsync_tombstones
            where user_id = v_user
        ), '[]'::jsonb)
    );
end;
$$;

-- ------------------------------------------------------------
-- 5. 权限收紧（沿用既有规范）
-- ------------------------------------------------------------
revoke all on function public.bsync_snapshot_push(jsonb, jsonb, text) from public;
revoke all on function public.bsync_snapshot_pull() from public;

grant execute on function public.bsync_snapshot_push(jsonb, jsonb, text) to authenticated;
grant execute on function public.bsync_snapshot_pull() to authenticated;

-- ------------------------------------------------------------
-- 6. 对象注释
-- ------------------------------------------------------------
comment on table public.bsync_tombstones is
    '删除墓碑：记录被删除书签的 sync_id，粘性传播删除（不会复活）。按 (user_id, sync_id) 定位，device 标记删除来源';
comment on function public.bsync_snapshot_push(jsonb, jsonb, text) is
    '推送书签同步快照。入参 p_data 为新格式扁平节点数组（含 sync_id / parent_sync_id / type / url / title / order / updated_at），p_tombstones 为[{sync_id,url}]，p_device 为本设备ID。服务端按 sync_id 过滤已删除节点并合并墓碑，返回 {ok,size,quota,plan}';
comment on function public.bsync_snapshot_pull() is
    '拉取最新书签同步快照与墓碑列表。返回 {bookmarks:节点数组, tombstones:[{sync_id,url}]}';