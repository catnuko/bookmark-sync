-- 0011 License 专属表/函数加 lic_ 前缀
-- 背景：licenses / license_usage_logs / user_tokens / user_profiles + consume_license /
--       extend_license / consume_token 此前无前缀（0008 基线化时按远端原样）。
--       随租户增多，无前缀的 license 对象越来越难辨识，统一加 lic_ 前缀。
-- 范围：仅 license 专属对象；projects / project_members / profiles / 余额函数不动。
-- 注意：ALTER TABLE RENAME 不自动更新函数体中的表名引用，必须 DROP + 重建函数。
-- 顺序：重命名表 → 重命名索引 → 删旧 RLS → 删旧函数 → 建新函数 → 建新 RLS → 权限。

-- ============================================================
-- 1. 重命名表
-- ============================================================

alter table if exists public.licenses rename to lic_licenses;
alter table if exists public.license_usage_logs rename to lic_usage_logs;
alter table if exists public.user_tokens rename to lic_user_tokens;
alter table if exists public.user_profiles rename to lic_user_profiles;

-- ============================================================
-- 2. 重命名索引（ALTER TABLE RENAME 不自动重命名索引）
-- ============================================================

alter index if exists public.licenses_expire_idx rename to lic_licenses_expire_idx;
alter index if exists public.licenses_usage_idx rename to lic_licenses_usage_idx;
alter index if exists public.license_usage_logs_key_time_idx rename to lic_usage_logs_key_time_idx;
alter index if exists public.license_usage_logs_ip_time_idx rename to lic_usage_logs_ip_time_idx;
alter index if exists public.user_tokens_user_idx rename to lic_user_tokens_user_idx;
alter index if exists public.user_tokens_user_active_idx rename to lic_user_tokens_user_active_idx;

-- ============================================================
-- 3. 删除旧 RLS 策略（表名已变，策略挂在旧表名上需先删）
-- ============================================================

drop policy if exists user_profiles_insert_own on public.lic_user_profiles;
drop policy if exists user_profiles_own_select on public.lic_user_profiles;
drop policy if exists user_profiles_select_own on public.lic_user_profiles;
drop policy if exists user_profiles_update_own on public.lic_user_profiles;
drop policy if exists user_tokens_own_select on public.lic_user_tokens;

-- ============================================================
-- 4. 删除旧函数（函数体引用旧表名，必须删除重建）
-- ============================================================

drop function if exists public.consume_license(uuid, text);
drop function if exists public.extend_license(uuid, text, integer);
drop function if exists public.consume_token(text);

-- ============================================================
-- 5. 创建新函数（lic_ 前缀，函数体引用新表名）
-- ============================================================

-- 消费 License：校验并增加 used_count
create or replace function public.lic_consume_license(p_project uuid, p_key text)
returns table(ok boolean, reason text, license_key text, expire_date timestamp with time zone, is_active boolean, max_usage integer, used_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.lic_licenses%rowtype;
begin
  select * into v
    from public.lic_licenses
   where public.lic_licenses.project_id = p_project
     and public.lic_licenses.license_key = p_key;

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

  update public.lic_licenses
     set used_count = public.lic_licenses.used_count + 1,
         last_used_at = now()
   where public.lic_licenses.id = v.id
  returning public.lic_licenses.license_key,
           public.lic_licenses.expire_date,
           public.lic_licenses.is_active,
           public.lic_licenses.max_usage,
           public.lic_licenses.used_count
  into v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;

  return query select true, 'valid', v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
end
$function$;

-- 延长 License 有效期
create or replace function public.lic_extend_license(p_project uuid, p_key text, p_days integer)
returns table(license_key text, expire_date timestamp with time zone, is_active boolean, max_usage integer, used_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.lic_licenses%rowtype;
begin
  select * into v
    from public.lic_licenses
   where public.lic_licenses.project_id = p_project
     and public.lic_licenses.license_key = p_key;

  if not found then
    return;
  end if;

  update public.lic_licenses
     set expire_date = greatest(v.expire_date, now()) + (p_days || ' days')::interval
   where public.lic_licenses.id = v.id
  returning public.lic_licenses.license_key,
           public.lic_licenses.expire_date,
           public.lic_licenses.is_active,
           public.lic_licenses.max_usage,
           public.lic_licenses.used_count
  into v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;

  return query
    select v.license_key, v.expire_date, v.is_active, v.max_usage, v.used_count;
end
$function$;

-- 消费 Token
create or replace function public.lic_consume_token(p_token text)
returns table(ok boolean, reason text, token text, plan text, expire_date timestamp with time zone, is_active boolean, used_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.lic_user_tokens%rowtype;
begin
  select * into v
    from public.lic_user_tokens
   where public.lic_user_tokens.token = p_token;

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

  update public.lic_user_tokens
     set used_count = public.lic_user_tokens.used_count + 1,
         last_used_at = now()
   where public.lic_user_tokens.id = v.id
  returning public.lic_user_tokens.token,
           public.lic_user_tokens.plan,
           public.lic_user_tokens.expire_date,
           public.lic_user_tokens.is_active,
           public.lic_user_tokens.used_count
  into v.token, v.plan, v.expire_date, v.is_active, v.used_count;

  return query select true, 'valid', v.token, v.plan, v.expire_date, v.is_active, v.used_count;
end
$function$;

-- ============================================================
-- 6. 重建 RLS 策略（在新表名上）
-- ============================================================

create policy lic_user_profiles_insert_own on public.lic_user_profiles
    for insert to public
    with check (auth.uid() = user_id);

create policy lic_user_profiles_own_select on public.lic_user_profiles
    for select to public
    using (auth.uid() = user_id);

create policy lic_user_profiles_select_own on public.lic_user_profiles
    for select to public
    using (auth.uid() = user_id);

create policy lic_user_profiles_update_own on public.lic_user_profiles
    for update to public
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy lic_user_tokens_own_select on public.lic_user_tokens
    for select to public
    using (auth.uid() = user_id);

-- ============================================================
-- 7. 权限（重命名后旧 GRANT 自动失效，需重新声明）
-- ============================================================

revoke all on table public.lic_licenses from anon, authenticated;
revoke all on table public.lic_usage_logs from anon, authenticated;
revoke all on table public.lic_user_tokens from anon, authenticated;
grant select on table public.lic_user_profiles to authenticated;

-- 函数执行权限
revoke all on function public.lic_consume_license(uuid, text) from anon;
revoke all on function public.lic_extend_license(uuid, text, integer) from anon;
revoke all on function public.lic_consume_token(text) from anon;

-- ============================================================
-- 8. 注释
-- ============================================================

comment on table public.lic_licenses is 'License 激活码表（lic_ 前缀，0011 迁移从 licenses 重命名）';
comment on table public.lic_usage_logs is 'License 使用日志表（lic_ 前缀，0011 迁移从 license_usage_logs 重命名）';
comment on table public.lic_user_tokens is '用户自助 SDK Token 表（lic_ 前缀，0011 迁移从 user_tokens 重命名）';
comment on table public.lic_user_profiles is '用户订阅状态表（lic_ 前缀，0011 迁移从 user_profiles 重命名）';
comment on function public.lic_consume_license(p_project uuid, p_key text) is '消费 License：校验并增加 used_count（0011 迁移从 consume_license 重命名）';
comment on function public.lic_extend_license(p_project uuid, p_key text, p_days integer) is '延长 License 有效期（0011 迁移从 extend_license 重命名）';
comment on function public.lic_consume_token(p_token text) is '消费 SDK Token（0011 迁移从 consume_token 重命名）';
