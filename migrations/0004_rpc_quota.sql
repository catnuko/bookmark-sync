-- 配额校验 + 付费门控 RPC（bsync_ 前缀，与库内其他项目隔离）
-- 在 Supabase Dashboard 的 SQL Editor 中执行，或在本地 `supabase db push`。
--
-- 设计意图：
--   1. bsync_snapshot_push：替代扩展直接 insert 快照，内含配额检查
--   2. bsync_snapshot_restore：恢复历史快照，免费用户抛 plan_locked
--   3. bsync_get_profile：返回当前用户的 plan / used / quota（前端读用）
--
-- 配额口径：只算当前快照大小（用 octet_length(p_data::text)）
--   - 历史快照不占用配额（Free 用户的 5MB 只看当前书签树 JSON）
--   - 写入新快照时更新 used_bytes 为本次写入大小

-- ============================================================
-- 1. bsync_snapshot_push：推送快照（含配额检查）
-- ============================================================
-- 旧版扩展可能直接调 insert，这里我们提供 RPC 路径
-- 旧的 bsync_snapshots 表已存在（见 0002_snapshot.sql）

create or replace function public.bsync_snapshot_push(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user    uuid;
    v_size    bigint;
    v_profile record;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 计算快照大小（UTF-8 字节数）
    v_size := octet_length(p_data::text);

    -- 兜底：profile 不存在则自动创建（覆盖 trigger 未生效的旧用户）
    perform public.bsync_ensure_profile(v_user);

    select * into v_profile from public.bsync_profiles where user_id = v_user;

    -- 配额检查：只看本次快照大小是否超出 quota_bytes
    if v_size > v_profile.quota_bytes then
        raise exception 'quota_exceeded';
    end if;

    -- 写入快照
    insert into public.bsync_snapshots (user_id, data) values (v_user, p_data);

    -- 更新 used_bytes 为本次快照大小
    update public.bsync_profiles
       set used_bytes = v_size
     where user_id = v_user;

    return jsonb_build_object(
        'ok', true,
        'size', v_size,
        'quota', v_profile.quota_bytes,
        'plan', v_profile.plan
    );
end;
$$;

-- ============================================================
-- 2. bsync_snapshot_restore：恢复历史快照（含 plan 门控）
-- ============================================================

create or replace function public.bsync_snapshot_restore(p_snapshot_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user  uuid;
    v_plan  text;
    v_data  jsonb;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    -- 读取 profile 拿 plan（profile 不存在兜底创建）
    perform public.bsync_ensure_profile(v_user);
    select plan into v_plan from public.bsync_profiles where user_id = v_user;

    -- 免费用户抛 plan_locked，扩展捕获后弹升级 modal
    if v_plan is null or v_plan = 'free' then
        raise exception 'plan_locked';
    end if;

    -- 读取指定快照（RLS 隔离：只能拿到自己的）
    select data into v_data
      from public.bsync_snapshots
     where id = p_snapshot_id and user_id = v_user;

    if v_data is null then
        raise exception 'not_found';
    end if;

    return v_data;
end;
$$;

-- ============================================================
-- 3. bsync_get_profile：返回当前用户档案（前端读用）
-- ============================================================
-- 前端也可以直接 select * from bsync_profiles，但 RPC 统一出口，
-- 同时做 profile 兜底创建，避免新用户读到空。

create or replace function public.bsync_get_profile()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user uuid;
    v_profile record;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;

    perform public.bsync_ensure_profile(v_user);

    select plan, quota_bytes, used_bytes, purchased_at
      into v_profile
      from public.bsync_profiles
     where user_id = v_user;

    return jsonb_build_object(
        'plan', v_profile.plan,
        'quota_bytes', v_profile.quota_bytes,
        'used_bytes', v_profile.used_bytes,
        'purchased_at', v_profile.purchased_at
    );
end;
$$;

-- ============================================================
-- 权限收紧
-- ============================================================
revoke all on function public.bsync_snapshot_push(jsonb) from public;
revoke all on function public.bsync_snapshot_restore(bigint) from public;
revoke all on function public.bsync_get_profile() from public;

grant execute on function public.bsync_snapshot_push(jsonb) to authenticated;
grant execute on function public.bsync_snapshot_restore(bigint) to authenticated;
grant execute on function public.bsync_get_profile() to authenticated;
