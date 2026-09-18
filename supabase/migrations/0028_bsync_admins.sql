-- ============================================================================
-- 0028 bsync_admins.sql — 管理员判定与共享注册表解耦
-- 日期：2026-09-19
-- 背景：assert_bsync_admin（0020）依赖共享表 project_members + 硬编码
--       bsync_admin_project_id() 常量判定管理员，是 bsync 对多租户注册表的
--       唯一强依赖。本项目收敛为 bsync 单租户（0029 将拆除共享层），管理员
--       判定改查 bsync 自己的 bsync_admins 表。
-- 行为：admin_whoami 返回结构不变（{is_admin, email}），前端零改动；
--       非成员语义不变（assert 抛 forbidden / whoami 返回 is_admin=false）。
-- 授权：bsync_admins 不建任何 RLS 策略（PostgREST 默认全拒），
--       仅经本 RPC 与 SQL/service_role 管理；成员增删走一次性 SQL 或
--       service_role，不暴露客户端写路径。
-- 幂等性：create if not exists / or replace，可安全重放。
-- 范围：仅 bsync_* 前缀对象。
-- ============================================================================

create table if not exists public.bsync_admins (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    note       text not null default '',
    created_at timestamptz not null default now()
);
alter table public.bsync_admins enable row level security;
comment on table public.bsync_admins is
'bsync 后台管理员名单：仅经 assert_bsync_admin/admin_whoami 读取，成员经 SQL/service_role 管理';

create or replace function public.assert_bsync_admin()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.bsync_admins a where a.user_id = auth.uid()) then
    raise exception 'forbidden: not a bsync admin';
  end if;
end;
$$;
comment on function public.assert_bsync_admin() is
'后台管理鉴权：当前 auth.uid() 必须在 bsync_admins 中，否则抛 forbidden（0028 起不再依赖 project_members）';

-- 返回结构保持 {is_admin, email}，前端路由守卫无感
create or replace function public.admin_whoami()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
    v_email text;
    v_is_admin boolean;
begin
    if v_uid is null then
        return jsonb_build_object('is_admin', false, 'email', null);
    end if;
    select email into v_email from auth.users where id = v_uid;
    select exists (select 1 from public.bsync_admins where user_id = v_uid) into v_is_admin;
    return jsonb_build_object('is_admin', v_is_admin, 'email', v_email);
end;
$$;

-- 授权口径与 0020 一致：authenticated 可调，anon 拒绝
revoke all on function public.assert_bsync_admin() from anon;
revoke all on function public.admin_whoami() from anon;
grant execute on function public.assert_bsync_admin() to authenticated;
grant execute on function public.admin_whoami() to authenticated;
