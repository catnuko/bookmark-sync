-- 书签同步 — Supabase 迁移脚本
-- 请在 Supabase Dashboard 的 SQL Editor 中执行，或在本地 `supabase db push`。
-- 执行前把下方 sync_secret 的 token 换成你自己的同步密钥（与扩展选项页填写的密钥一致）。

-- 书签表：sid 由序列生成，version 单调递增用于增量同步
create table if not exists public.bookmarks (
    sid     bigint generated always as identity primary key,
    url     text    not null default '',
    title   text    not null default '',
    folder  text    not null default '',
    deleted boolean not null default false,
    version bigint  not null
);

create index if not exists idx_bookmarks_version on public.bookmarks (version);
create index if not exists idx_bookmarks_url on public.bookmarks (url);

-- 密钥表：只有 RPC 函数（security definer）能读到，前端无法直接访问
create table if not exists public.sync_secret (
    k text primary key,
    v text not null
);

insert into public.sync_secret (k, v)
values ('token', '替换为你的同步密钥')
on conflict (k) do nothing;

-- 推送本地变更：与原来的 FastAPI /push 逻辑一致（版本号递增 + URL 去重 + 墓碑）
create or replace function public.sync_push(p_token text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token   text;
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
    select v into v_token from sync_secret where k = 'token';
    if v_token is null or p_token is null or p_token <> v_token then
        raise exception 'invalid token';
    end if;

    -- 串行化整个推送，保证版本号连续且无并发竞争
    perform pg_advisory_xact_lock(1);

    select coalesce(max(version), 0) into v_version from bookmarks;

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
                update bookmarks set deleted = true, version = v_version where sid = v_sid;
            else
                update bookmarks
                   set url = v_url, title = v_title, folder = v_folder, deleted = false, version = v_version
                 where sid = v_sid;
            end if;
            result := result || jsonb_build_object('sid', v_sid);
        else
            -- 新增：同 URL 已存在则复用（两台设备先后添加同一书签 / 删除后重新添加）
            select sid into exists_id
              from bookmarks
             where url = v_url
             order by deleted, version desc
             limit 1;

            if exists_id is not null then
                update bookmarks
                   set title = v_title, folder = v_folder, deleted = false, version = v_version
                 where sid = exists_id;
                result := result || jsonb_build_object('sid', exists_id);
            else
                insert into bookmarks (url, title, folder, deleted, version)
                values (v_url, v_title, v_folder, false, v_version)
                returning sid into out_sid;
                result := result || jsonb_build_object('sid', out_sid);
            end if;
        end if;
    end loop;

    return jsonb_build_object('version', v_version, 'items', result);
end;
$$;

-- 拉取版本号大于 since 的全部变更
create or replace function public.sync_pull(p_token text, p_since bigint default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_token   text;
    v_current bigint;
    items     jsonb;
begin
    select v into v_token from sync_secret where k = 'token';
    if v_token is null or p_token is null or p_token <> v_token then
        raise exception 'invalid token';
    end if;

    select coalesce(max(version), 0) into v_current from bookmarks;

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
    from bookmarks
    where version > p_since;

    return jsonb_build_object('version', v_current, 'items', items);
end;
$$;

-- 收紧权限：数据只能经由 RPC 函数访问，前端 key（anon）无法直接读写表
alter table public.bookmarks enable row level security;
alter table public.sync_secret enable row level security;

revoke all on table public.bookmarks from anon, authenticated;
revoke all on table public.sync_secret from anon, authenticated;

grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_pull(text, bigint) to anon, authenticated;