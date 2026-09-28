-- 0044_subscription_expiry_sweep.sql — 订阅到期兜底降级 + 清理失效 cron
-- ------------------------------------------------------------------
-- 背景：Creem 的 `subscription.canceled` 语义是「不再续费」，**不是**「立即失效」。
-- 客户门户里点取消后，事件 object 的 `current_period_end_date` 仍指向本期末
-- （2026-09-28 实测：取消于当天 12:58，到期日 2027-09-28）。Creem 文档也写明
-- `subscription.scheduled_cancel`「在 current_period_end_date 之前保持 active」。
--
-- 而**门户实际发的是 canceled 而非 scheduled_cancel**（实测确认），所以
-- bsync-creem-webhook 必须自己按账期判断，不能对 canceled 无条件降级——
-- 否则用户关掉自动续费就会立刻失去已付费的整年服务。
--
-- 改法见函数源码：未到期 → 保留 plan、status 记 scheduled_cancel；
-- 已到期 → 降级 free。
--
-- 「已到期」需要一个触发者。Creem 文档里由 `subscription.expired` 负责这个转换，
-- 我们订阅了也写了处理，但**无法验证它一定会送达**（要等真实到期日，等不起）。
-- 所以这里加一个每日兜底：把 status 仍停在取消态、且 current_period_end 已过期的
-- 订阅降级——不依赖 Creem 是否补发 expired。
--
-- 顺带清掉 jobid=1 的僵尸任务：license_usage_logs 已在 0029 随多租户层拆除，
-- 该任务自那以后每天 03:00 报 `relation "public.license_usage_logs" does not exist`。
-- ------------------------------------------------------------------

-- 0) 重放安全：pg_cron 在 preview branch / db reset 场景可能未启用
create extension if not exists pg_cron;

-- 1) 到期扫描函数（SECURITY DEFINER：cron 以 owner 身份执行）
create or replace function public.bsync_expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_downgraded int := 0;
begin
  -- 只处理「已取消且账期走完」的订阅。past_due / paused / unpaid 属于宽限期
  -- 状态，是否停服由 webhook 的宽限策略决定，不在这里动。
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
         quota_bytes = 1048576  -- 与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES.free 对齐
    from ended e
   where p.user_id = e.user_id
     and p.plan <> 'free';

  get diagnostics v_downgraded = row_count;
  return v_downgraded;
end $$;

comment on function public.bsync_expire_subscriptions() is
  '订阅到期兜底：把 current_period_end 已过的 canceled/scheduled_cancel 订阅转为 expired 并降级 free。pg_cron 每日调用，兜底 Creem subscription.expired 未送达的情况。返回本次降级的 profile 数。';

-- 不开放给 Data API：只有 cron（owner）需要执行
revoke all on function public.bsync_expire_subscriptions() from public, anon, authenticated;

-- 2) 每日调度（03:23 UTC；错开 03:00，避免与其它任务撞点）
select cron.schedule(
  'bsync-expire-subscriptions',
  '23 3 * * *',
  $cron$select public.bsync_expire_subscriptions()$cron$
);

-- 3) 清理僵尸任务（license_usage_logs 已在 0029 删除）
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-license-logs') then
    perform cron.unschedule('cleanup-license-logs');
  end if;
end $$;
