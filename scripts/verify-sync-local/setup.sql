-- 本地模拟 Supabase auth 层（供迁移与 RPC 测试）
do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    -- Supabase 默认还有 service_role（边缘函数/后台直连用）。缺了它，0027 起
    -- 所有 `grant ... to service_role` 的迁移在本地重放会直接失败。
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin;
    end if;
end $$;

drop schema if exists auth cascade;
create schema auth;
grant usage on schema auth to anon, authenticated;

-- 复刻 Supabase 对 public schema 的默认权限（迁移里的 revoke/grant 在此基础上生效）
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all routines in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on routines to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
create table auth.users (
    id         uuid primary key,
    email      text not null default '',
    created_at timestamptz not null default now()
);

-- Supabase 的 auth.uid()：读 PostgREST 注入的 JWT 声明
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
