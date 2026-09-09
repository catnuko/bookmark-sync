-- 书签同步 — Supabase 迁移脚本（bsync_ 前缀，与库内其他项目隔离）
-- 在 Supabase Dashboard 的 SQL Editor 中执行，或在本地 `supabase db push`。
-- 登录/注册复用 Supabase Auth（邮箱 + 密码 + 自动确认），不用任何自建密钥系统。
-- 先在 Dashboard → Authentication → Providers → Email 关闭 "Confirm email"，注册即登录。

-- 清理旧的「密钥」方案（仅当之前执行过旧版迁移时有效，可安全重复执行）
drop function if exists public.bsync_sync_push(text, jsonb) cascade;
drop function if exists public.bsync_sync_pull(text, bigint) cascade;
drop table if exists public.bsync_sync_secret cascade;

-- 书签表：sid 由序列生成，user_id 绑定登录用户，version 单调递增用于增量同步
create table if not exists public.bsync_bookmarks (
    sid     bigint generated always as identity primary key,
    user_id uuid    not null references auth.users (id) on delete cascade,
    url     text    not null default '',
    title   text    not null default '',
    folder  text    not null default '',
    deleted boolean not null default false,
    version bigint  not null
);

-- 老表升级路径：补充 user_id 列（旧行 user_id 为空会被 RLS 忽略）
alter table public.bsync_bookmarks
    add column if not exists user_id uuid references auth.users (id) on delete cascade;

drop index if exists idx_bsync_bookmarks_version;
drop index if exists idx_bsync_bookmarks_url;
create index if not exists idx_bsync_bookmarks_user_version on public.bsync_bookmarks (user_id, version);
create index if not exists idx_bsync_bookmarks_user_url on public.bsync_bookmarks (user_id, url);

-- 行级安全：每个用户只能读写自己的书签
alter table public.bsync_bookmarks enable row level security;

drop policy if exists bsync_own_bookmarks on public.bsync_bookmarks;
create policy bsync_own_bookmarks on public.bsync_bookmarks
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- 收紧权限：匿名角色无法触碰表，认证角色经由 RLS 访问
revoke all on table public.bsync_bookmarks from anon;
grant select, insert, update, delete on table public.bsync_bookmarks to authenticated;
grant usage on sequence public.bsync_bookmarks_sid_seq to authenticated;

-- 推送本地变更：与原来的 /push 逻辑一致（版本号递增 + URL 去重 + 墓碑）。
-- security invoker 让 RLS 真正生效，auth.uid() 取自当前登录用户的 JWT。
create or replace function public.bsync_sync_push(p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user    uuid;
    v_version bigint;
    item      jsonb;
    v_sid     bigint;
    v_url     text;
    v_title   text;
    v_folder  text;
    v_deleted boolean;
    exists_id bigint;
    out_sid   bigint;
    result    jsonb := '[]'::jsonb;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 串行化整个推送，保证版本号连续且无并发竞争（使用该项目的专属 advisory lock key）
    perform pg_advisory_xact_lock(99887766);

    select coalesce(max(version), 0) into v_version from bsync_bookmarks;

    for item in select * from jsonb_array_elements(p_items) loop
        v_version := v_version + 1;
        v_sid     := (item ->> 'sid')::bigint;
        v_url     := coalesce(item ->> 'url', '');
        v_title   := coalesce(item ->> 'title', '');
        v_folder  := coalesce(item ->> 'folder', '');
        v_deleted := coalesce((item ->> 'deleted')::boolean, false);

        if v_sid is not null then
            -- 已有条目：更新或打墓碑（墓碑保留原 url/title/folder，便于日后复活去重）
            if v_deleted then
                update bsync_bookmarks set deleted = true, version = v_version where sid = v_sid and user_id = v_user;
            else
                update bsync_bookmarks
                   set url = v_url, title = v_title, folder = v_folder, deleted = false, version = v_version
                 where sid = v_sid and user_id = v_user;
            end if;
            result := result || jsonb_build_object('sid', v_sid);
        else
            -- 新增：同 URL 已存在则复用（两台设备先后添加同一书签 / 删除后重新添加）
            select sid into exists_id
              from bsync_bookmarks
             where url = v_url and user_id = v_user
             order by deleted, version desc
             limit 1;

            if exists_id is not null then
                update bsync_bookmarks
                   set title = v_title, folder = v_folder, deleted = false, version = v_version
                 where sid = exists_id and user_id = v_user;
                result := result || jsonb_build_object('sid', exists_id);
            else
                insert into bsync_bookmarks (user_id, url, title, folder, deleted, version)
                values (v_user, v_url, v_title, v_folder, false, v_version)
                returning sid into out_sid;
                result := result || jsonb_build_object('sid', out_sid);
            end if;
        end if;
    end loop;

    return jsonb_build_object('version', v_version, 'items', result);
end;
$$;

-- 拉取版本号大于 since 的全部变更
create or replace function public.bsync_sync_pull(p_since bigint default 0)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user    uuid;
    v_current bigint;
    items     jsonb;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    select coalesce(max(version), 0) into v_current from bsync_bookmarks;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'sid', sid, 'url', url, 'title', title,
                'folder', folder, 'deleted', deleted, 'version', version
            )
            order by version
        ),
        '[]'::jsonb
    )
    into items
    from bsync_bookmarks
    where version > p_since and user_id = v_user;

    return jsonb_build_object('version', v_current, 'items', items);
end;
$$;

-- 仅认证用户可以调用 RPC
revoke all on function public.bsync_sync_push(jsonb) from public;
revoke all on function public.bsync_sync_pull(bigint) from public;
grant execute on function public.bsync_sync_push(jsonb) to authenticated;
grant execute on function public.bsync_sync_pull(bigint) to authenticated;