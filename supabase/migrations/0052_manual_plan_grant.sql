-- ============================================================================
-- 0052 manual_plan_grant.sql — 手工开通会员（微信转账等站外支付）+ 到期自动降级
-- 日期：2026-10-20
--
-- 需求：国内用户无法用 Creem 付款。管理员收微信转账后，需要在后台**手工开通
--   会员并指定到期时间**，到期后自动降级 free。当前 admin_set_user_plan 只能改
--   plan，没有到期概念；且两个每日 sweep（0044 到期 / 2026-10-08 退款）会按
--   订单/订阅判据把手工设置的 plan 每晚冲回 free —— 实测账号
--   346746061@qq.com 每天 04:23 UTC 被 bsync_refund_downgrade_sweep 降级。
--
-- 设计：
--   · 新增 plan_source：'auto'（Creem 订阅驱动）/ 'manual'（管理员手工授予）。
--   · 新增 plan_expires_at：仅 manual 有意义，**必填**（业务上要求明确期限）。
--   · 两个既有 sweep 只处理 plan_source='auto' —— 手工授予的账号绝不被它们碰。
--   · 新增 bsync_manual_plan_expire_sweep()：manual 且已过期的降 free。
--   · admin_set_user_plan 增加 p_expires_at；设非 free 时强制要求到期时间。
--
-- 为什么手工账号不被退款/到期 sweep 处理：那些 sweep 的判据是「Creem 订单与
--   订阅的状态」，而手工授予根本没有对应的 Creem 记录 —— 判据永远成立，
--   于是每晚都会降级。语义上手工授予本就该由人（到期时间）管，不由订单管。
--
-- 幂等性：add column if not exists / create or replace，可安全重放。
-- 范围：仅 bsync_profiles 表与 admin_*/bsync_* 函数（本租户）。
-- ============================================================================

-- ---------- 1) 增列 ----------
alter table public.bsync_profiles
  add column if not exists plan_source text not null default 'auto';
alter table public.bsync_profiles
  add column if not exists plan_expires_at timestamptz;

-- 只允许两个取值（用 DO 块判定，可重放）
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.bsync_profiles'::regclass
       and conname  = 'bsync_profiles_plan_source_check'
  ) then
    alter table public.bsync_profiles
      add constraint bsync_profiles_plan_source_check
      check (plan_source in ('auto', 'manual'));
  end if;
end $$;

comment on column public.bsync_profiles.plan_source is
'plan 的来源：auto = Creem 订单/订阅驱动（两个每日 sweep 按订单判据降级）；manual = 管理员手工授予（微信转账等站外支付），只由 plan_expires_at 决定何时降级。0052';
comment on column public.bsync_profiles.plan_expires_at is
'手工授予的到期时间（仅 plan_source=manual 有意义，业务上必填）。到期后由 bsync_manual_plan_expire_sweep 降为 free。0052';

-- 手工授予到期扫描走这条索引
create index if not exists bsync_profiles_manual_expiry_idx
  on public.bsync_profiles (plan_expires_at)
  where plan_source = 'manual';

-- ---------- 2) 两个既有 sweep 跳过手工账号 ----------
-- 0044：账期到期兜底
create or replace function public.bsync_expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_downgraded int := 0;
begin
  with ended as (
    update public.bsync_subscriptions
       set status = 'expired',
           updated_at = now()
     where status in ('canceled', 'scheduled_cancel')
       and current_period_end is not null
       and current_period_end <= now()
    returning user_id
  )
  update public.bsync_profiles p
     set plan = 'free',
         quota_bytes = 5242880
    from ended e
   where p.user_id = e.user_id
     and p.plan <> 'free'
     and p.plan_source = 'auto';   -- 0052：手工授予的账号不归订单管

  get diagnostics v_downgraded = row_count;
  return v_downgraded;
end $$;

comment on function public.bsync_expire_subscriptions() is
'订阅到期兜底：把 current_period_end 已过的 canceled/scheduled_cancel 订阅转为 expired 并降级 free。仅处理 plan_source=auto 的账号（0052：手工授予由到期时间单独管）。pg_cron 每日调用。';

-- 2026-10-08：退款降级兜底
create or replace function public.bsync_refund_downgrade_sweep()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_downgraded int := 0;
begin
  with refunded_users as (
    select distinct s.user_id
      from public.bsync_subscriptions s
     where exists (
             select 1 from public.bsync_orders o
              where o.user_id = s.user_id
                and o.status = 'refunded'
           )
       and not exists (
             select 1 from public.bsync_subscriptions s2
              where s2.user_id = s.user_id
                and s2.status in ('active', 'trialing', 'scheduled_cancel', 'past_due')
           )
  )
  update public.bsync_profiles p
     set plan = 'free',
         quota_bytes = 5242880
    from refunded_users r
   where p.user_id = r.user_id
     and p.plan <> 'free'
     and p.plan_source = 'auto';   -- 0052：手工授予的账号不归订单管

  get diagnostics v_downgraded = row_count;
  return v_downgraded;
end $$;

comment on function public.bsync_refund_downgrade_sweep() is
'退款降级兜底：已退款且无任何生效订阅的账号降级 free。仅处理 plan_source=auto 的账号（0052：手工授予由到期时间单独管）。';

-- ---------- 3) 手工授予到期扫描 ----------
create or replace function public.bsync_manual_plan_expire_sweep()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_downgraded int := 0;
begin
  update public.bsync_profiles p
     set plan = 'free',
         quota_bytes = 5242880,
         plan_expires_at = null
   where p.plan_source = 'manual'
     and p.plan <> 'free'
     and p.plan_expires_at is not null
     and p.plan_expires_at <= now();

  get diagnostics v_downgraded = row_count;
  return v_downgraded;
end $$;

comment on function public.bsync_manual_plan_expire_sweep() is
'手工授予到期：plan_source=manual 且 plan_expires_at 已过的账号降为 free。pg_cron 每日调用。0052';

revoke all on function public.bsync_manual_plan_expire_sweep() from public, anon, authenticated;

-- 每日调度：05:23 UTC（与 0044 的 03:23、退款的 04:23 各错开一小时）
select cron.schedule(
  'bsync-manual-plan-expire',
  '23 5 * * *',
  $cron$select public.bsync_manual_plan_expire_sweep()$cron$
);

-- ---------- 4) 后台改 plan：带到期时间 ----------
-- 注意：参数变多会让 PG 视为**新函数**与旧三参版并存（0050 踩过）。
-- 先 drop 旧签名，保证只剩一个重载。
drop function if exists public.admin_set_user_plan(uuid, text);

create or replace function public.admin_set_user_plan(
  p_user       uuid,
  p_plan       text,
  p_expires_at timestamptz default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old       text;
  v_old_src   text;
  v_new_quota bigint;
  v_src       text;
  v_exp       timestamptz;
begin
  perform public.assert_bsync_admin();
  if p_plan not in ('free', 'plus', 'pro', 'lifetime') then
    raise exception 'invalid plan';
  end if;

  select plan, plan_source into v_old, v_old_src
    from public.bsync_profiles where user_id = p_user;

  -- 配额与 plan 对齐（0048 权威值，与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES 一致）
  v_new_quota := case p_plan
    when 'free'     then 5242880        -- 5MiB ≈ 1,000 条
    when 'plus'     then 20971520       -- 20MiB ≈ 10,000 条
    when 'pro'      then 524288000      -- 500MB
    when 'lifetime' then 524288000
  end;

  -- 0052：手工授予非 free 计划**必须**指定到期时间（业务要求明确期限）
  if p_plan <> 'free' then
    if p_expires_at is null then
      raise exception 'expires_at_required';
    end if;
    if p_expires_at <= now() then
      raise exception 'expires_at_in_past';
    end if;
    v_src := 'manual';
    v_exp := p_expires_at;
  else
    -- 改回 free：结束手工授予，到期时间清空
    v_src := case when v_old_src = 'manual' then 'manual' else 'auto' end;
    v_exp := null;
  end if;

  update public.bsync_profiles
     set plan = p_plan,
         quota_bytes = v_new_quota,
         purchased_at = coalesce(purchased_at, now()),
         plan_source = v_src,
         plan_expires_at = v_exp
   where user_id = p_user;

  insert into public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  values (auth.uid(), 'set_plan', p_user,
          jsonb_build_object(
            'old', v_old,
            'new', p_plan,
            'quota_bytes', v_new_quota,
            'plan_source', v_src,
            'expires_at', v_exp
          ));
end;
$$;

comment on function public.admin_set_user_plan(uuid, text, timestamptz) is
'后台手动改用户 plan，同时对齐 quota_bytes；非 free 计划必须给到期时间（0052 手工授予），到期后由 bsync_manual_plan_expire_sweep 降 free。写审计日志。';

revoke all on function public.admin_set_user_plan(uuid, text, timestamptz) from anon;
grant execute on function public.admin_set_user_plan(uuid, text, timestamptz) to authenticated;
