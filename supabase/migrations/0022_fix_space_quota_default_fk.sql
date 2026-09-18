-- 0022_fix_space_quota_default_fk.sql
-- 修复多空间功能的三个回归（0017 v2 重写时丢失、远端实际状态）：
--   1. bsync_space_create 缺付费配额检查（Free 用户可无限建空间，绕过付费墙）
--   2. bsync_space_delete 缺默认空间保护（可删除默认空间，级联清空设备/op/snapshot）
--   3. bsync_op_log.space_id 缺外键 ON DELETE CASCADE（删空间后留孤儿 op_log）
--
-- 幂等：OR REPLACE / DROP CONSTRAINT IF EXISTS / 先清孤儿再加外键，可安全重放。
-- 错误语义与前端 store.js 对齐：raise exception 的 message 即 reason，
--   sync.js 会把它映射到 r.reason（plan_locked / cannot_delete_default / duplicate）。

-- ============================================================
-- 1. bsync_space_create：恢复付费配额 + 首个空间默认
-- ============================================================
create or replace function public.bsync_space_create(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid;
    v_count int;
    v_limit int;
    v_plan  text;
    v_row   public.bsync_spaces;
begin
    v_owner := auth.uid();
    if v_owner is null then
        raise exception 'not_authenticated';
    end if;

    p_name := btrim(coalesce(p_name, ''));
    if p_name = '' or length(p_name) > 50 then
        raise exception 'invalid_name';
    end if;

    -- 确保 profile 存在（与 bsync_get_profile 一致的惰性创建）
    insert into public.bsync_profiles (user_id) values (v_owner)
    on conflict (user_id) do nothing;

    select plan into v_plan from public.bsync_profiles where user_id = v_owner;
    v_limit := case v_plan
        when 'free'     then 1
        when 'plus'     then 3
        when 'premium'  then 3
        when 'basic'    then 3
        else 10              -- pro / lifetime / team
    end;

    select count(*) into v_count from public.bsync_spaces where owner_id = v_owner;
    if v_count >= v_limit then
        raise exception 'plan_locked';
    end if;

    insert into public.bsync_spaces (owner_id, name, is_default)
    values (v_owner, p_name, v_count = 0)
    returning * into v_row;

    return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'is_default', v_row.is_default);
end;
$$;

comment on function public.bsync_space_create(text) is
'创建同步空间。配额：free 1 / plus·premium·basic 3 / pro·lifetime·team 10；首个空间自动 is_default；超额 raise plan_locked，重名由唯一索引 raise 23505';

-- ============================================================
-- 2. bsync_space_delete：恢复默认空间保护
-- ============================================================
create or replace function public.bsync_space_delete(p_space uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid;
begin
    v_owner := auth.uid();
    if v_owner is null then
        raise exception 'not_authenticated';
    end if;

    -- 默认空间不可删（它是存量数据与新设备的落点）；删除空间级联清空其快照/设备/op_log
    if exists (
        select 1 from public.bsync_spaces
         where id = p_space and owner_id = v_owner and is_default
    ) then
        raise exception 'cannot_delete_default';
    end if;

    delete from public.bsync_spaces
     where id = p_space and owner_id = v_owner;
    if not found then
        raise exception 'not_found';
    end if;
end;
$$;

comment on function public.bsync_space_delete(uuid) is
'删除自己的非默认同步空间，级联清空设备/操作日志/快照。默认空间不可删（raise cannot_delete_default）';

-- ============================================================
-- 3. bsync_op_log.space_id 补外键 ON DELETE CASCADE
--    先清理历史孤儿（指向已删空间的 op_log），再加外键。
-- ============================================================
delete from public.bsync_op_log o
where not exists (
    select 1 from public.bsync_spaces s where s.id = o.space_id
);

alter table public.bsync_op_log
  drop constraint if exists bsync_op_log_space_id_fkey;

alter table public.bsync_op_log
  add constraint bsync_op_log_space_id_fkey
  foreign key (space_id) references public.bsync_spaces(id) on delete cascade;

comment on constraint bsync_op_log_space_id_fkey on public.bsync_op_log is
'操作日志按空间级联删除（0022 补回；0017 建表时声明但远端实际缺失，导致删空间留孤儿 op_log）';

-- ============================================================
-- 4. bsync_spaces 唯一索引：v2 表改用 owner_id，0014 的
--    (user_id,name) 唯一索引/默认部分索引从未在 v2 表上重建。
--    先清理重复名，再建唯一索引。
-- ============================================================
-- 4.1 清理重复名空间（保留最早创建的那条）
delete from public.bsync_spaces a
using public.bsync_spaces b
where a.owner_id = b.owner_id
  and a.name = b.name
  and a.created_at > b.created_at;

-- 4.2 同用户空间名唯一
create unique index if not exists bsync_spaces_owner_name_idx
  on public.bsync_spaces (owner_id, name);

-- 4.3 每用户至多一个默认空间
create unique index if not exists bsync_spaces_owner_default_idx
  on public.bsync_spaces (owner_id) where is_default;

-- ============================================================
-- 5. 权限（与 0017/0021 一致：仅 authenticated 可执行）
-- ============================================================
revoke all on function public.bsync_space_create(text) from public;
revoke all on function public.bsync_space_delete(uuid) from public;
grant execute on function public.bsync_space_create(text) to authenticated;
grant execute on function public.bsync_space_delete(uuid) to authenticated;
