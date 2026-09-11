-- 0008 基线迁移：License/Token 计费系统
-- 背景：licenses / user_tokens / profiles / projects / project_members / user_profiles / license_usage_logs
--       这 7 张表 + 8 个函数此前绕过迁移文件，直接在远端 Dashboard 手动创建。
--       本迁移将远端现状固化（幂等），确保「全新环境 push 0001~0008 = 远端现状」。
-- 与 bsync_* 前缀区分：这是 snaply 项目的 License/Token/计费子系统（无前缀，按远端原样）。
-- 注意：远端对这些表授予了 anon 全权限（历史遗留，见 0006 收紧思路），此处按现状基线化，未做收紧。
-- 顺序说明：表 → 函数 → RLS 策略（策略引用了 is_project_member 函数，必须先建函数）。

-- ============================================================
-- 1. 表（全部先建，不含策略）
-- ============================================================

-- 1.1 projects
create table if not exists public.projects (
    id         uuid primary key default gen_random_uuid(),
    slug       text unique,
    name       text not null,
    owner_id   uuid,
    created_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- 1.2 project_members（多对多：项目成员）
create table if not exists public.project_members (
    project_id uuid not null references public.projects (id),
    user_id    uuid not null,
    role       text not null default 'member',
    primary key (project_id, user_id)
);

alter table public.project_members enable row level security;

-- 1.3 profiles（项目内用户余额，主键为 (id, project_id)）
create table if not exists public.profiles (
    id          uuid not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    project_id  uuid not null references public.projects (id),
    balance_usd numeric not null default 2.0,
    primary key (id, project_id)
);

alter table public.profiles enable row level security;

-- 1.4 user_profiles（用户订阅状态）
create table if not exists public.user_profiles (
    user_id             uuid primary key,
    plan                text not null default 'free',
    subscription_status text not null default 'inactive',
    expires_at          timestamptz,
    updated_at          timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- 1.5 licenses（License 卡）
create table if not exists public.licenses (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null default '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'::uuid,
    license_key  text not null,
    expire_date  timestamptz not null,
    is_active    boolean not null default true,
    max_usage    integer not null default 1,
    used_count   integer not null default 0,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz,
    unique (project_id, license_key)
);

create index if not exists licenses_expire_idx on public.licenses (project_id, expire_date);
create index if not exists licenses_usage_idx on public.licenses (project_id, is_active, max_usage, used_count);

alter table public.licenses enable row level security;

-- 1.6 license_usage_logs（License 使用日志）
create table if not exists public.license_usage_logs (
    id           bigint generated always as identity primary key,
    project_id   uuid not null default '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'::uuid,
    license_key  text not null,
    ip           inet,
    user_agent   text,
    request_time timestamptz not null default now(),
    result       text not null default 'valid'
);

create index if not exists license_usage_logs_key_time_idx on public.license_usage_logs (project_id, license_key, request_time desc);
create index if not exists license_usage_logs_ip_time_idx on public.license_usage_logs (project_id, ip, request_time desc);

alter table public.license_usage_logs enable row level security;

-- 1.7 user_tokens（API Token 卡）
create table if not exists public.user_tokens (
    id           uuid primary key default gen_random_uuid(),
    project_id   uuid not null default '885e7f27-f4ad-447d-8f17-e18fac1dcf0a'::uuid,
    user_id      uuid not null,
    token        text not null,
    name         text not null default '默认令牌',
    plan         text not null default 'pro',
    is_active    boolean not null default true,
    expire_date  timestamptz not null,
    used_count   integer not null default 0,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz,
    unique (token)
);

create index if not exists user_tokens_user_idx on public.user_tokens (user_id, created_at desc);
create index if not exists user_tokens_user_active_idx on public.user_tokens (user_id, is_active);

alter table public.user_tokens enable row level security;

-- ============================================================
-- 2. 函数（按远端 pg_get_functiondef 原样还原）
-- ============================================================

-- 项目成员判断（sql / stable，供 RLS 使用）
create or replace function public.is_project_member(p_project uuid)
returns boolean
language sql
stable
as $function$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project and m.user_id = auth.uid()
  );
$function$;

-- 确保当前用户是项目成员（供其他 SECURITY DEFINER 函数调用）
create or replace function public.ensure_membership(p_project uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  insert into public.project_members (project_id, user_id)
  values (p_project, uid)
  on conflict (project_id, user_id) do nothing;
end;
$function$;

-- 加余额
create or replace function public.add_balance(p_project uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r numeric; begin if uid is null then return null; end if; perform public.ensure_membership(p_project); insert into public.profiles (id, project_id, balance_usd) values (uid, p_project, greatest(p_amount, 0)) on conflict (id, project_id) do update set balance_usd = public.profiles.balance_usd + greatest(p_amount, 0), updated_at = now(); select balance_usd into r from public.profiles where id = uid and project_id = p_project; return r; end; $function$;

-- 扣余额（下限 0）
create or replace function public.consume_balance(p_project uuid, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r numeric; begin if uid is null then return null; end if; perform public.ensure_membership(p_project); update public.profiles set balance_usd = greatest(balance_usd - greatest(p_amount, 0), 0), updated_at = now() where id = uid and project_id = p_project; select balance_usd into r from public.profiles where id = uid and project_id = p_project; return r; end; $function$;

-- 查询余额
create or replace function public.get_balance(p_project uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); r numeric; begin if uid is null then return null; end if; perform public.ensure_membership(p_project); insert into public.profiles (id, project_id) values (uid, p_project) on conflict (id, project_id) do nothing; select balance_usd into r from public.profiles where id = uid and project_id = p_project; return r; end; $function$;

-- 消费 License：校验并增加 used_count
create or replace function public.consume_license(p_project uuid, p_key text)
returns table(ok boolean, reason text, license_key text, expire_date timestamp with time zone, is_active boolean, max_usage integer, used_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.licenses%rowtype;
begin
  select * into v
    from public.licenses
   where public.licenses.project_id = p_project
     and public.licenses.license_key = p_key;

  if not found then
    return query select false, 'invalid', null::text, null::timestamptz, null::boolean, null::integer, null::integer;
    return;
  end if;

  if not v.is_active then
    return query select false, 'disabled', v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
    return;
  end if;

  if v.expire_date <= now() then
    return query select false, 'expired', v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
    return;
  end if;

  if v.used_count >= v.max_usage then
    return query select false, 'over_usage', v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
    return;
  end if;

  update public.licenses
     set used_count = public.licenses.used_count + 1,
         last_used_at = now()
   where public.licenses.id = v.id
  returning public.licenses.license_key,
           public.licenses.expire_date,
           public.licenses.is_active,
           public.licenses.max_usage,
           public.licenses.used_count
  into v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;

  return query select true, 'valid', v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
end
$function$;

-- 延长 License 有效期
create or replace function public.extend_license(p_project uuid, p_key text, p_days integer)
returns table(license_key text, expire_date timestamp with time zone, is_active boolean, max_usage integer, used_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.licenses%rowtype;
begin
  select * into v
    from public.licenses
   where public.licenses.project_id = p_project
     and public.licenses.license_key = p_key;

  if not found then
    return;
  end if;

  update public.licenses
     set expire_date = greatest(v.expire_date, now()) + (p_days || ' days')::interval
   where public.licenses.id = v.id
  returning public.licenses.license_key,
           public.licenses.expire_date,
           public.licenses.is_active,
           public.licenses.max_usage,
           public.licenses.used_count
  into v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;

  return query
    select v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
end
$function$;

-- 消费 Token
create or replace function public.consume_token(p_token text)
returns table(ok boolean, reason text, token text, plan text, expire_date timestamp with time zone, is_active boolean, used_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.user_tokens%rowtype;
begin
  select * into v
    from public.user_tokens
   where public.user_tokens.token = p_token;

  if not found then
    return query select false, 'invalid', null::text, null::text, null::timestamptz, null::boolean, null::integer;
    return;
  end if;

  if not v.is_active then
    return query select false, 'disabled', v.token, v.plan, v.expire_date, v.is_active, v.used_count;
    return;
  end if;

  if v.expire_date <= now() then
    return query select false, 'expired', v.token, v.plan, v.expire_date, v.is_active, v.used_count;
    return;
  end if;

  update public.user_tokens
     set used_count = public.user_tokens.used_count + 1,
         last_used_at = now()
   where public.user_tokens.id = v.id
  returning public.user_tokens.token,
           public.user_tokens.plan,
           public.user_tokens.expire_date,
           public.user_tokens.is_active,
           public.user_tokens.used_count
  into v.token, v.plan, v.expire_date, v.is_active, v.used_count;

  return query select true, 'valid', v.token, v.plan, v.expire_date, v.is_active, v.used_count;
end
$function$;

-- ============================================================
-- 3. RLS 策略（依赖 is_project_member 函数，须在函数之后）
-- ============================================================

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
    for insert to public
    with check (owner_id = auth.uid());

drop policy if exists projects_owner_select on public.projects;
create policy projects_owner_select on public.projects
    for select to public
    using (owner_id = auth.uid() or public.is_project_member(id));

drop policy if exists pm_insert_self on public.project_members;
create policy pm_insert_self on public.project_members
    for insert to public
    with check (user_id = auth.uid());

drop policy if exists pm_select on public.project_members;
create policy pm_select on public.project_members
    for select to public
    using (public.is_project_member(project_id));

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
    for select to public
    using (id = auth.uid() and public.is_project_member(project_id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
    for update to public
    using (id = auth.uid() and public.is_project_member(project_id))
    with check (id = auth.uid() and public.is_project_member(project_id));

drop policy if exists user_profiles_insert_own on public.user_profiles;
create policy user_profiles_insert_own on public.user_profiles
    for insert to public
    with check (auth.uid() = user_id);

drop policy if exists user_profiles_own_select on public.user_profiles;
create policy user_profiles_own_select on public.user_profiles
    for select to public
    using (auth.uid() = user_id);

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own on public.user_profiles
    for select to public
    using (auth.uid() = user_id);

drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own on public.user_profiles
    for update to public
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists user_tokens_own_select on public.user_tokens;
create policy user_tokens_own_select on public.user_tokens
    for select to public
    using (auth.uid() = user_id);

-- ============================================================
-- 4. 权限（按远端现状基线化；功能通过 SECURITY DEFINER RPC 暴露）
-- ============================================================
-- 与 bsync_* 收紧思路一致：表级权限从 anon/authenticated 收回，
-- 业务操作统一走 SECURITY DEFINER 函数。
revoke all on table public.licenses from anon, authenticated;
revoke all on table public.license_usage_logs from anon, authenticated;
revoke all on table public.user_tokens from anon, authenticated;
revoke all on table public.projects from anon;
revoke all on table public.project_members from anon;
revoke all on table public.profiles from anon;
grant select on table public.profiles to authenticated;
grant select on table public.user_profiles to authenticated;

-- 函数执行权限：SECURITY DEFINER 函数对 public 可见即可由 authenticated 调用
revoke all on function public.is_project_member(uuid) from anon;
revoke all on function public.consume_license(uuid, text) from anon;
revoke all on function public.extend_license(uuid, text, integer) from anon;
revoke all on function public.consume_token(text) from anon;
