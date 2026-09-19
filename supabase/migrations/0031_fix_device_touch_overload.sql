-- ============================================================================
-- 0031 fix_device_touch_overload.sql — 修正 0030：对准真实重载与表结构
-- 日期：2026-09-19
-- 背景：0030 误判了目标。线上 bsync_devices 是 0017 形态
--       (id uuid PK / space_id / name / last_seen_at)，客户端心跳实际走
--       bsync_device_touch(p_space uuid, p_device uuid, p_name text)（0017）；
--       0030 改写的 (text, text, uuid) 重载与 bsync_device_rename(text, text)
--       均引用不存在的列（user_id/device_id，0014 旧形态残留），一直是坏的
--       死代码。0030 的「心跳不覆盖名字」意图正确，但改错了重载。
-- 本迁移：
--   1) drop 0030 误写的 (text,text,uuid) touch 重载与坏死的 (text,text) rename；
--   2) 对真实重载 (uuid,uuid,text)：冲突更新不再覆盖 name（手动改名可留存）；
--   3) bsync_device_rename 重建为 (uuid, text)，按 space 属主校验（per-space
--      设备模型），名单语义与 0014 版一致（invalid_name / not_found）。
-- 验证：touch→改名→再 touch，name 稳定（见 0031 部署记录）。
-- 幂等性：drop if exists / or replace，可安全重放。
-- 范围：仅 bsync_* 前缀函数。
-- ============================================================================

-- 1) 清理坏死重载
drop function if exists public.bsync_device_touch(text, text, uuid);
drop function if exists public.bsync_device_rename(text, text);

-- 2) 真实心跳重载：name 仅首次登记生效
create or replace function public.bsync_device_touch(p_space uuid, p_device uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.bsync_spaces where id = p_space and owner_id = auth.uid()) then
    return;
  end if;
  insert into public.bsync_devices (id, space_id, name)
  values (p_device, p_space, coalesce(nullif(btrim(p_name), ''), p_device::text))
  on conflict (space_id, id) do update set last_seen_at = now();
end;
$$;

-- 3) 设备改名：per-space 模型，按空间属主校验
create or replace function public.bsync_device_rename(p_device uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  p_name := btrim(coalesce(p_name, ''));
  if p_name = '' or length(p_name) > 50 then
    raise exception 'invalid_name';
  end if;
  update public.bsync_devices d
     set name = p_name
   where d.id = p_device
     and exists (select 1 from public.bsync_spaces s
                  where s.id = d.space_id and s.owner_id = auth.uid());
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.bsync_device_touch(uuid, uuid, text) from anon;
revoke all on function public.bsync_device_rename(uuid, text)       from anon;
grant execute on function public.bsync_device_touch(uuid, uuid, text) to authenticated;
grant execute on function public.bsync_device_rename(uuid, text)       to authenticated;

comment on function public.bsync_device_touch(uuid, uuid, text) is
'设备心跳：登记或刷新 last_seen_at；name 仅首次登记取客户端上报值，此后只能经 bsync_device_rename 修改（0031 修正 0030）';
comment on function public.bsync_device_rename(uuid, text) is
'设备改名（仅空间属主，1~50 字符）；per-space 设备模型（0031 重建，取代 0014 的坏死版本）';
