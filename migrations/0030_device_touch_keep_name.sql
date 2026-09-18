-- ============================================================================
-- 0030 device_touch_keep_name.sql — 心跳不再覆盖已登记设备名
-- 日期：2026-09-19
-- 背景：bsync_device_touch 每次同步都会带上客户端从 UA 自动探测的设备名
--       （detectDeviceName），冲突更新时直接覆盖 bsync_devices.name，
--       导致用户手动改名（bsync_device_rename）在下一次同步被冲掉。
-- 行为：name 仅在首次登记（insert）时取客户端上报值；已登记设备的名字
--       只能经 bsync_device_rename 修改。last_sync_at / last_space_id
--       心跳语义不变。
-- 幂等性：or replace，可安全重放。
-- 范围：仅 bsync_* 前缀函数。
-- ============================================================================

create or replace function public.bsync_device_touch(
    p_device text,
    p_name   text default null,
    p_space  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user uuid;
begin
    v_user := auth.uid();
    if v_user is null then
        raise exception 'not authenticated';
    end if;
    if coalesce(p_device, '') = '' then
        return;
    end if;

    insert into public.bsync_devices (user_id, device_id, name, last_space_id, last_sync_at)
    values (v_user, p_device, coalesce(nullif(btrim(p_name), ''), p_device), p_space, now())
    on conflict (user_id, device_id) do update
        set last_sync_at  = now(),
            last_space_id = excluded.last_space_id;
end;
$$;
comment on function public.bsync_device_touch(text, text, uuid) is
'设备心跳：登记或刷新 last_sync_at/last_space_id；name 仅首次登记取客户端上报值，此后只能经 bsync_device_rename 修改（0030）';
