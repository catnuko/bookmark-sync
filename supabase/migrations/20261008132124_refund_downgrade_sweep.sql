-- 20261008132124_refund_downgrade_sweep.sql — 修复「已退款但 plan 未降级」的历史脏数据
-- ------------------------------------------------------------------
-- 【plan 枚举的真相在这里】读 0003 的人会被第11 行的
--     check (plan in ('free','pro','lifetime')) 误导 —— 那条约束**早已失效**，
--     0013 已 drop 掉并换成含 plus 的版本：
--         alter table public.bsync_profiles drop constraint if exists bsync_profiles_plan_check;
--         update ... set plan='free' where plan not in ('free','plus','pro','lifetime');
--         alter table public.bsync_profiles add constraint bsync_profiles_plan_check
--             check (plan in ('free','plus','pro','lifetime'));
--     全量重放 0001→今天 是安全的，Plus 写入不会被拒。
--     ★ 唯一会踩的坑：**单独执行 0003**（不做全量重放）会把 plus 写入全拒。
--       正确做法永远是全量重放或`supabase db push`，别手工挑单个迁移跑。
--     （按 AGENTS.md / TENANTS.md 第 24 行「禁止修改已提交的历史迁移」，
--       所以这条说明只能写在**新增**迁移里，不能回去给 0003 加注释。）
--
-- 背景（2026-10-08 用户报「退款了还能享受一年 pro」）：
--
--   bsync-creem-webhook 的 refund.created 分支只把 bsync_orders.status 改成
--   'refunded'，**从不碰 bsync_profiles.plan**。而全函数唯一的降级点在「取消/到期」
--   分支里，退款事件走不到；迁移 0044 的每日兜底也只扫「账期已过的取消态」，
--   账期在未来的单子同样扫不到。
--
--   结果：退款 = 钱回来了但会员照用，直到账期结束。线上就是这个状态：
--     bsync_orders:  status='refunded'
--     bsync_profiles: plan='pro', quota_bytes=524288000
--
-- 语义澄清（这两件事不能共用判据）：
--   取消续费 = 不再续费，已付费的服务期还没结束 → **保留 plan**（原逻辑是对的）
--   退款     = 钱已经回来了还继续用 → **必须立即降级**，与账期无关
--
-- 本迁移做两件事：
--   1) 一次性数据修复：把「所有订阅订单都已退款、且 profile 仍非 free」的账号降级。
--      —— 只修历史脏数据，不加常驻任务。新逻辑已在 webhook 里。
--   2) 把退款降级纳入每日兜底，覆盖 webhook 漏投 / 函数服务不可用时的自愈。
-- ------------------------------------------------------------------

-- ------------------------------------------------------------------
-- 1) 一次性数据修复
-- ------------------------------------------------------------------
do $$
declare
  v_fixed int := 0;
begin
  -- 判据：该用户至少有一笔 refunded 订单，**且没有任何一行订阅是生效态**，
  -- 而 profile 还停在非 free。
  -- 「没有任何生效态」这一条是防误伤：退了旧订阅、但还开着别的订阅的用户不受影响。
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
         quota_bytes = 1048576  -- 与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES.free 对齐
    from refunded_users r
   where p.user_id = r.user_id
     and p.plan <> 'free';

  get diagnostics v_fixed = row_count;
  raise notice 'refund downgrade sweep: % profile(s) downgraded', v_fixed;
end $$;

-- ------------------------------------------------------------------
-- 2) 把「退款降级」并入每日兜底
-- 0044 的 bsync_expire_subscriptions 只处理「账期已过的取消态」，
-- 这里另起一个：退款用户里没有生效订阅的，降级 free。
-- 两者语义不同（到期 vs 退款），所以不合并进同一个函数。
-- ------------------------------------------------------------------
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
         quota_bytes = 1048576
    from refunded_users r
   where p.user_id = r.user_id
     and p.plan <> 'free';

  get diagnostics v_downgraded = row_count;
  return v_downgraded;
end $$;

comment on function public.bsync_refund_downgrade_sweep() is
  '退款降级兜底：已退款且无任何生效订阅的账号降级 free。与 bsync_expire_subscriptions（账期到期降级）分开，因语义不同——退款与账期无关。返回本次降级的 profile 数。';

-- 不开放给 Data API：只有 cron（owner）需要执行
revoke all on function public.bsync_refund_downgrade_sweep() from public, anon, authenticated;

-- 挂到每日调度（04:23 UTC，与 0044 的 03:23 错开一小时）
select cron.schedule(
  'bsync-refund-downgrade',
  '23 4 * * *',
  $cron$select public.bsync_refund_downgrade_sweep()$cron$
);