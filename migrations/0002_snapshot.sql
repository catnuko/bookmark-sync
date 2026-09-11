-- 书签同步 — 快照方案迁移（替换旧的逐行表方案）
-- 改为每次同步保存完整书签树 JSON，保留历史快照可随时恢复

-- 清理旧方案
drop function if exists public.bsync_sync_push(jsonb) cascade;
drop function if exists public.bsync_sync_pull(bigint) cascade;
drop table if exists public.bsync_bookmarks cascade;

-- 快照表：每次同步保存完整书签树为 JSON
create table public.bsync_snapshots (
    id         bigint generated always as identity primary key,
    user_id    uuid    not null references auth.users (id) on delete cascade,
    data       jsonb   not null,
    created_at timestamptz not null default now()
);

-- RLS：每个用户只能读写自己的快照
alter table public.bsync_snapshots enable row level security;

create policy bsync_own_snapshots on public.bsync_snapshots
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

revoke all on table public.bsync_snapshots from anon;
grant select, insert on table public.bsync_snapshots to authenticated;
grant usage on sequence public.bsync_snapshots_id_seq to authenticated;
