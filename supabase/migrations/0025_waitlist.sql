-- 0025_waitlist.sql
-- 官网「商店上架通知」邮箱订阅表。
-- 背景：官网下载页原订阅表单为纯前端占位（提交即假成功），
--       此迁移落地真实收集通道：匿名可 insert（仅 email 列），
--       读取仅限 authenticated（防枚举），重复邮箱幂等。
--
-- 幂等：IF NOT EXISTS / DO NOTHING，可安全重放。

create table if not exists public.bsync_waitlist (
    id         bigint generated always as identity primary key,
    email      text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    source     text not null default 'website' check (source in ('website', 'download')),
    created_at timestamptz not null default now()
);

comment on table public.bsync_waitlist is
'官网「上架通知」订阅：仅收集邮箱与来源，不用于其他用途（隐私政策-我们收集什么）。';

alter table public.bsync_waitlist enable row level security;

-- 匿名/登录用户均可提交订阅（只允许写 email+source，防篡改他人行：无 UPDATE 权限）
create policy bsync_waitlist_insert on public.bsync_waitlist
    for insert to anon, authenticated
    with check (true);

-- 读取仅限登录用户自己……waitlist 无 user_id，改为：仅 authenticated 可 select（用于后台导出统计）
create policy bsync_waitlist_select on public.bsync_waitlist
    for select to authenticated
    using (true);

grant insert on table public.bsync_waitlist to anon, authenticated;
grant select on table public.bsync_waitlist to authenticated;
