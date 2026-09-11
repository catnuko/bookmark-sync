-- 用户档案表：付费状态 + 配额（bsync_ 前缀，与库内其他项目隔离）
-- 三档定价：Free 5MB / Pro 50MB / Lifetime 500MB
-- 在 Supabase Dashboard 的 SQL Editor 中执行，或在本地 `supabase db push`。

-- ============================================================
-- 用户档案表
-- ============================================================

create table if not exists public.bsync_profiles (
    user_id      uuid primary key references auth.users (id) on delete cascade,
    plan         text not null default 'free' check (plan in ('free', 'pro', 'lifetime')),
    quota_bytes  bigint not null default 5242880,   -- 5MB（Free 默认）
    used_bytes   bigint not null default 0,
    purchased_at timestamptz,
    created_at   timestamptz not null default now()
);

-- RLS：每个用户只能读自己的 profile（写权限只给 RPC，不给前端直接 update）
alter table public.bsync_profiles enable row level security;

drop policy if exists bsync_own_profile on public.bsync_profiles;
create policy bsync_own_profile on public.bsync_profiles
    for select to authenticated
    using (auth.uid() = user_id);

-- 收紧权限：认证用户只能 select profile，不能直接 update（plan 变更走 Edge Function webhook）
revoke all on table public.bsync_profiles from anon;
grant select on table public.bsync_profiles to authenticated;

-- ============================================================
-- 自动创建 profile：新用户注册时自动插入一行 free 档位
-- 通过 trigger 在 auth.users 插入后自动执行
-- ============================================================

-- 兜底函数：确保某个用户有 profile 行（RPC 内部首行也会调用）
create or replace function public.bsync_ensure_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.bsync_profiles (user_id) values (p_user)
        on conflict (user_id) do nothing;
end;
$$;

-- trigger 函数：新用户注册时自动建 profile
create or replace function public.bsync_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.bsync_ensure_profile(new.id);
    return new;
end;
$$;

-- 绑定 trigger 到 auth.users 的插入事件
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.bsync_handle_new_user();

-- 权限收紧
revoke all on function public.bsync_ensure_profile(uuid) from public;
revoke all on function public.bsync_handle_new_user() from public;
-- 不需要给 authenticated 显式授权，因为 trigger 由系统在 superuser 上下文执行
