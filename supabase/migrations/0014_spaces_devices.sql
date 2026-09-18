-- ============================================================
-- 0014: 多同步空间 + 设备注册表
-- ------------------------------------------------------------
-- 背景：
--   1. Chrome 多用户资料装同一扩展、登同一账号，会把两棵不同的书签树
--      静默合并到一起，且因墓碑粘性难以解绑 → 需要「同步空间」隔离，
--      每个资料可绑定不同空间（工作 / 个人）。
--   2. 服务端此前没有设备注册表，deviceId 仅作为墓碑归属参数存在 →
--      无法做设备管理（查看 / 改名 / 移除），也没有"账号已被其他设备
--      同步"的知情提示依据。
--
-- 空间模型（占位 + 开通）：
--   - bsync_spaces：每用户多个空间，is_default 标记默认空间（每用户至多一个）。
--   - 快照与墓碑增加 space_id 维度（NOT NULL，历史数据回填到默认空间）。
--   - push/pull RPC 增加 p_space 参数（缺省 → 默认空间，行为与改造前完全一致）。
--   - 配额按用户总量计（跨空间求各空间最新快照大小之和），不按空间拆分配额。
--   - 空间数配额：free 1 个 / plus 3 个 / pro、lifetime 10 个（空间数是付费卖点）。
--   - 存量用户无需迁移：老账号全部回填进默认空间，老设备行为不变。
--
-- 设备模型：
--   - bsync_devices：(user_id, device_id) 注册表，push 时自动登记/刷新
--     last_sync_at、last_space_id、name。
--   - bsync_device_remove：移除设备同时清除该设备的墓碑——这是"误合并
--     解绑"的逃生通道（该设备制造的删除不再传播）。
--   - 客户端在同步前查询其他活跃设备并提示"将合并书签"，确认后放行。
--
-- 兼容性：
--   - 本迁移重写 push/pull（沿用 0005/0007 的 drop + recreate 模式，不改历史迁移）。
--   - 墓碑主键从 (user_id, sync_id) 扩为 (user_id, space_id, sync_id)，
--     同一 sync_id 可在不同空间独立存在/删除。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 空间表
-- ------------------------------------------------------------
create table public.bsync_spaces (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid   not null references auth.users (id) on delete cascade,
    name       text   not null,
    is_default boolean not null default false,
    created_at timestamptz not null default now()
);

-- 同一用户空间名不重复；默认空间每用户至多一个（部分唯一索引）
create unique index bsync_spaces_user_name_idx on public.bsync_spaces (user_id, name);
create unique index bsync_spaces_user_default_idx on public.bsync_spaces (user_id) where is_default;

alter table public.bsync_spaces enable row level security;

create policy bsync_own_spaces on public.bsync_spaces
    for select to authenticated
    using (auth.uid() = user_id);

revoke all on table public.bsync_spaces from anon;
grant select on table public.bsync_spaces to authenticated;
-- 写入只走 RPC（bsync_space_create / rename / delete，见下），防客户端绕过配额

-- ------------------------------------------------------------
-- 2. 快照 / 墓碑增加 space_id，并回填默认空间
-- ------------------------------------------------------------
alter table public.bsync_snapshots
    add column space_id uuid references public.bsync_spaces (id) on delete cascade;
alter table public.bsync_tombstones
    add column space_id uuid references public.bsync_spaces (id) on delete cascade;

-- 为已产生过数据的用户补建默认空间（新用户由 push/pull RPC 惰性创建）
insert into public.bsync_spaces (user_id, name, is_default)
select u.user_id, '默认空间', true
from (
    select user_id from public.bsync_profiles
    union
    select user_id from public.bsync_snapshots
    union
    select user_id from public.bsync_tombstones
) u
where not exists (
    select 1 from public.bsync_spaces s where s.user_id = u.user_id
);

-- 历史数据全部归属默认空间
update public.bsync_snapshots snap
   set space_id = d.id
  from public.bsync_spaces d
 where d.user_id = snap.user_id and d.is_default and snap.space_id is null;

update public.bsync_tombstones tomb
   set space_id = d.id
  from public.bsync_spaces d
 where d.user_id = tomb.user_id and d.is_default and tomb.space_id is null;

alter table public.bsync_snapshots alter column space_id set not null;
alter table public.bsync_tombstones alter column space_id set not null;

-- 墓碑定位键加入 space 维度：同一 sync_id 在不同空间独立删除/恢复
alter table public.bsync_tombstones drop constraint bsync_tombstones_pkey;
alter table public.bsync_tombstones add primary key (user_id, space_id, sync_id);

create index if not exists bsync_snapshots_space_idx
    on public.bsync_snapshots (user_id, space_id, created_at desc);
create index if not exists bsync_tombstones_space_idx
    on public.bsync_tombstones (user_id, space_id, created_at desc);

-- ------------------------------------------------------------
-- 3. 设备注册表
-- ------------------------------------------------------------
create table public.bsync_devices (
    user_id       uuid   not null references auth.users (id) on delete cascade,
    device_id     text   not null,
    name          text   not null default '',
    last_space_id uuid references public.bsync_spaces (id) on delete set null,
    last_sync_at  timestamptz not null default now(),
    created_at    timestamptz not null default now(),
    primary key (user_id, device_id)
);

create index if not exists bsync_devices_user_idx
    on public.bsync_devices (user_id, last_sync_at desc);

alter table public.bsync_devices enable row level security;

create policy bsync_own_devices on public.bsync_devices
    for select to authenticated
    using (auth.uid() = user_id);

revoke all on table public.bsync_devices from anon;
grant select on table public.bsync_devices to authenticated;
-- 登记由 push 内部经 bsync_device_touch（definer）完成；改名/移除走 RPC

-- ------------------------------------------------------------
-- 4. 空间 RPC：创建 / 改名 / 删除（security definer，写入唯一入口）
-- ------------------------------------------------------------
create or replace function public.bsync_space_create(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user  uuid;
    v_count int;
    v_limit int;
    v_plan  text;
    v_row   public.bsync_spaces;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    p_name := btrim(coalesce(p_name, ''));
    if p_name = '' or length(p_name) > 50 then
        raise exception 'invalid_name';
    end if;

    perform public.bsync_ensure_profile(v_user);
    select plan into v_plan from public.bsync_profiles where user_id = v_user;
    v_limit := case v_plan
        when 'free' then 1
        when 'plus' then 3
        when 'premium' then 3
        else 10              -- pro / lifetime
    end;

    select count(*) into v_count from public.bsync_spaces where user_id = v_user;
    if v_count >= v_limit then
        raise exception 'plan_locked';
    end if;

    insert into public.bsync_spaces (user_id, name, is_default)
    values (v_user, p_name, v_count = 0)
    returning * into v_row;

    return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'is_default', v_row.is_default);
end;
$$;

create or replace function public.bsync_space_rename(p_space uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    p_name := btrim(coalesce(p_name, ''));
    if p_name = '' or length(p_name) > 50 then
        raise exception 'invalid_name';
    end if;

    update public.bsync_spaces
       set name = p_name
     where id = p_space and user_id = v_user;
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

create or replace function public.bsync_space_delete(p_space uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 默认空间不可删（它是存量数据与新设备的落点）；删除空间级联清空其快照与墓碑
    if exists (
        select 1 from public.bsync_spaces
         where id = p_space and user_id = v_user and is_default
    ) then
        raise exception 'cannot_delete_default';
    end if;

    delete from public.bsync_spaces
     where id = p_space and user_id = v_user;
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

-- ------------------------------------------------------------
-- 5. 设备 RPC：登记 / 改名 / 移除
-- ------------------------------------------------------------
create or replace function public.bsync_device_touch(
    p_device text,
    p_name   text default null,
    p_space  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;
    if coalesce(p_device, '') = '' then
        return;
    end if;

    insert into public.bsync_devices (user_id, device_id, name, last_space_id, last_sync_at)
    values (v_user, p_device, coalesce(nullif(btrim(p_name), ''), p_device), p_space, now())
    on conflict (user_id, device_id) do update
        set last_sync_at  = now(),
            last_space_id = excluded.last_space_id,
            name = coalesce(nullif(btrim(p_name), ''), public.bsync_devices.name);
end;
$$;

create or replace function public.bsync_device_rename(p_device text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    p_name := btrim(coalesce(p_name, ''));
    if p_name = '' or length(p_name) > 50 then
        raise exception 'invalid_name';
    end if;

    update public.bsync_devices
       set name = p_name
     where user_id = v_user and device_id = p_device;
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

create or replace function public.bsync_device_remove(p_device text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 逃生通道：移除设备 = 注销 + 清掉它制造的墓碑，
    -- 该设备传播过的删除不再粘性生效（用于误合并后解绑恢复）
    delete from public.bsync_tombstones
     where user_id = v_user and device = p_device;

    delete from public.bsync_devices
     where user_id = v_user and device_id = p_device;
end;
$$;

-- ------------------------------------------------------------
-- 6. 重写 push：空间维度 + 用户总配额 + 设备登记
-- ------------------------------------------------------------
drop function if exists public.bsync_snapshot_push(jsonb, jsonb, text) cascade;

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
            select octet_length(ranked.data) as sz
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

-- ------------------------------------------------------------
-- 7. 重写 pull：空间维度
-- ------------------------------------------------------------
drop function if exists public.bsync_snapshot_pull() cascade;

create or replace function public.bsync_snapshot_pull(p_space uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user  uuid;
    v_space uuid;
    v_data  jsonb;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 解析空间（与 push 同规则；未指定 → 默认空间，惰性创建）
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

    select data into v_data
      from public.bsync_snapshots
     where user_id = v_user and space_id = v_space
     order by created_at desc
     limit 1;

    return jsonb_build_object(
        'space_id', v_space,
        'bookmarks', coalesce(v_data, '[]'::jsonb),
        'tombstones', coalesce((
            select jsonb_agg(jsonb_build_object('sync_id', sync_id, 'url', url) order by created_at desc)
            from public.bsync_tombstones
            where user_id = v_user and space_id = v_space
        ), '[]'::jsonb)
    );
end;
$$;

-- ------------------------------------------------------------
-- 8. 权限与注释
-- ------------------------------------------------------------
revoke all on function public.bsync_snapshot_push(jsonb, jsonb, text, uuid, text) from public;
revoke all on function public.bsync_snapshot_pull(uuid) from public;
revoke all on function public.bsync_space_create(text) from public;
revoke all on function public.bsync_space_rename(uuid, text) from public;
revoke all on function public.bsync_space_delete(uuid) from public;
revoke all on function public.bsync_device_touch(text, text, uuid) from public;
revoke all on function public.bsync_device_rename(text, text) from public;
revoke all on function public.bsync_device_remove(text) from public;
revoke execute on function public.bsync_device_touch(text, text, uuid) from anon;
revoke execute on function public.bsync_device_rename(text, text) from anon;
revoke execute on function public.bsync_device_remove(text) from anon;

grant execute on function public.bsync_snapshot_push(jsonb, jsonb, text, uuid, text) to authenticated;
grant execute on function public.bsync_snapshot_pull(uuid) to authenticated;
grant execute on function public.bsync_space_create(text) to authenticated;
grant execute on function public.bsync_space_rename(uuid, text) to authenticated;
grant execute on function public.bsync_space_delete(uuid) to authenticated;
grant execute on function public.bsync_device_touch(text, text, uuid) to authenticated;
grant execute on function public.bsync_device_rename(text, text) to authenticated;
grant execute on function public.bsync_device_remove(text) to authenticated;

comment on table public.bsync_spaces is
    '同步空间：同一账号可有多棵独立书签树（如工作/个人），快照与墓碑按 space_id 隔离。is_default 标记默认空间（每用户至多一个）';
comment on table public.bsync_devices is
    '设备注册表：push 时自动登记/刷新，用于设备管理（查看/改名/移除）与多设备合并前的知情提示';
comment on function public.bsync_space_create(text) is
    '创建同步空间。空间数配额：free 1 / plus 3 / pro、lifetime 10；首个空间自动设为默认。超额抛 plan_locked，重名抛 unique 违约';
comment on function public.bsync_space_rename(uuid, text) is
    '重命名自己的同步空间';
comment on function public.bsync_space_delete(uuid) is
    '删除自己的非默认同步空间，级联清空该空间的快照与墓碑。默认空间不可删（cannot_delete_default）';
comment on function public.bsync_device_touch(text, text, uuid) is
    '登记/刷新设备（push 内部自动调用，也可显式调用）；p_name 为空则保留原名';
comment on function public.bsync_device_rename(text, text) is
    '重命名自己的设备';
comment on function public.bsync_device_remove(text) is
    '移除设备并清除该设备制造的墓碑（误合并解绑的逃生通道：其删除不再粘性传播）';
comment on function public.bsync_snapshot_push(jsonb, jsonb, text, uuid, text) is
    '推送书签同步快照（空间维度）。p_space 缺省为默认空间；p_device_name 可选设备显示名。配额按用户总量计（各空间最新快照之和）。返回 {ok,size,total,quota,plan,space_id}';
comment on function public.bsync_snapshot_pull(uuid) is
    '拉取指定空间（缺省默认空间）的最新快照与墓碑。返回 {space_id, bookmarks, tombstones}，space_id 为实际生效空间';
