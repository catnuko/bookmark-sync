-- 0013 Creem 订阅打通：订单表 + 订阅表 + plan 档位扩展
-- 背景：官网/条款已宣称 Creem 订阅制（Plus $20/年 10k 条，Pro $50/年 无限），
--       但库内只有 lic_user_profiles（手动标记）与 bsync_profiles（按字节配额），
--       没有订单/订阅实体，支付回调无处落库。本迁移补齐 Creem 链路所需结构。
--
-- plan 语义调整：bsync_profiles.plan 原 CHECK 只允许 free/pro/lifetime（老容量定价）。
-- 新定价按条数（Plus 10k 条 / Pro 无限），同步引擎实际按 quota_bytes 执行，
-- 故折算：plus => 50MB（约可存 2.5 万条），pro => 500MB（约 25 万条，事实无限）。
-- lifetime 保留（历史手动授权用户不动），pro 由 webhook 接管翻转为新语义。
--
-- 写路径：订阅状态变更只允许 Creem Webhook（service role）写入；
--         用户对自己的订单/订阅只有 select 权限。

-- ============================================================
-- 1. 扩展 plan 枚举
-- ============================================================

alter table public.bsync_profiles drop constraint if exists bsync_profiles_plan_check;
-- 归一化遗留值（如手动标记用过的 premium）：加新 CHECK 前先收敛到合法枚举，否则约束创建失败
update public.bsync_profiles set plan = 'free' where plan not in ('free', 'plus', 'pro', 'lifetime');
alter table public.bsync_profiles
    add constraint bsync_profiles_plan_check
    check (plan in ('free', 'plus', 'pro', 'lifetime'));

-- ============================================================
-- 2. 订阅表（一个用户同时最多一条有效 Creem 订阅）
-- ============================================================

create table if not exists public.bsync_subscriptions (
    user_id               uuid primary key references auth.users (id) on delete cascade,
    plan                  text not null check (plan in ('plus', 'pro')),
    -- active=生效中 / scheduled_cancel=已约到期不再续 / past_due=扣款失败重试中
    -- canceled=已立即取消 / expired=到期未续（终态）
    status                text not null default 'active'
        check (status in ('active', 'scheduled_cancel', 'past_due', 'canceled', 'expired')),
    creem_subscription_id text not null unique,
    creem_customer_id     text,
    current_period_end    timestamptz,
    canceled_at           timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);

create index if not exists bsync_subscriptions_customer_idx
    on public.bsync_subscriptions (creem_customer_id);

-- ============================================================
-- 3. 订单表（Creem webhook 事件流水，用于对账）
-- ============================================================

create table if not exists public.bsync_orders (
    id                    uuid primary key default gen_random_uuid(),
    user_id               uuid references auth.users (id) on delete set null,
    plan                  text check (plan in ('plus', 'pro')),
    creem_checkout_id     text,
    creem_order_id        text,
    creem_subscription_id text,
    creem_customer_id     text,
    amount_cents          integer,
    currency              text,
    status                text not null default 'pending'
        check (status in ('pending', 'paid', 'refunded', 'failed')),
    event_type            text,
    payload               jsonb,
    created_at            timestamptz not null default now()
);

create index if not exists bsync_orders_user_idx
    on public.bsync_orders (user_id, created_at desc);
create index if not exists bsync_orders_subscription_idx
    on public.bsync_orders (creem_subscription_id);

-- ============================================================
-- 4. RLS（用户只读自己的；写入全部走 service role webhook）
-- ============================================================

alter table public.bsync_subscriptions enable row level security;
alter table public.bsync_orders enable row level security;

drop policy if exists bsync_subscriptions_select_own on public.bsync_subscriptions;
create policy bsync_subscriptions_select_own on public.bsync_subscriptions
    for select to authenticated
    using (auth.uid() = user_id);

drop policy if exists bsync_orders_select_own on public.bsync_orders;
create policy bsync_orders_select_own on public.bsync_orders
    for select to authenticated
    using (auth.uid() = user_id);

revoke all on table public.bsync_subscriptions from anon, authenticated;
revoke all on table public.bsync_orders from anon, authenticated;
grant select on table public.bsync_subscriptions to authenticated;
grant select on table public.bsync_orders to authenticated;
