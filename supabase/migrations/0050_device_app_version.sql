-- ============================================================================
-- 0050 device_app_version.sql — 设备登记扩展版本，后台可看「用户在用哪个版本」
-- 日期：2026-10-20
--
-- 需求：后台用户详情页只能看到设备名（如 "Edge · Windows"），看不到扩展版本，
--   无法判断用户是不是停在旧版本上。期望的展示口径是
--   「浏览器 · 系统 · 版本」，例如 "Edge · Windows · 2.10.1"。
--
-- 设计选择：**新增 app_version 列**，而不是把版本拼进 name。
--   · name 可被用户经 bsync_device_rename 手动改名（0031），一旦改名就丢版本；
--   · name 只在首次登记时写入（0030/0031「心跳不覆盖名字」），而版本需要随
--     扩展升级**持续刷新** —— 两者的更新语义正好相反。
--   因此版本必须独立成列，由每次心跳覆盖写入。
--
-- 变更：
--   1. bsync_devices 增 app_version text（可空，存量设备为空 —— 下次心跳补齐）；
--   2. bsync_device_touch 增加可选参数 p_app_version，心跳时覆盖写入；
--   3. admin_get_user 的 devices 数组增 app_version 字段。
--
-- 兼容性：新参数带 default null，旧版扩展（不传该参数）调用不受影响 ——
--   PostgREST 按参数名匹配，缺省值由 PG 填充。反过来，旧服务端 + 新版扩展
--   会因未知参数报 PGRST202，故**必须先部署本迁移再发扩展**。
--
-- 幂等性：add column if not exists / create or replace，可安全重放。
-- 范围：仅 bsync_* 前缀表与函数（本租户）。
-- ============================================================================

-- ---------- 1) 增列 ----------
alter table public.bsync_devices
  add column if not exists app_version text;

comment on column public.bsync_devices.app_version is
'客户端上报的扩展版本号（manifest version，如 2.10.1）。每次心跳覆盖写入，随升级自动刷新；存量设备为空，下次心跳补齐。与 name 分开存 —— name 可被用户改名且只写一次（0030/0031），语义相反。';

-- ---------- 2) 心跳：写入 app_version ----------
-- ★ 必须先 DROP 旧的三参重载（2026-10-20 实测踩坑）：
--   CREATE OR REPLACE 只有在**签名完全相同**时才替换函数体；这里多了一个
--   带默认值的参数，PG 会当成**新函数**与旧的三参版本并存，形成重载。
--   PostgREST 按参数名解析，两个重载都能匹配 → 调用报歧义/选错版本。
--   0031 已经因为同类问题清理过一次坏死重载，这里沿用同样的做法。
drop function if exists public.bsync_device_touch(uuid, uuid, text);

-- 在 0039 版基础上只加一个参数与一处 set，其余语义（新设备上限检查、
-- 换绑、只改自己设备行）一律不变。
CREATE OR REPLACE FUNCTION public.bsync_device_touch(
  p_space       uuid,
  p_device      uuid,
  p_name        text,
  p_app_version text default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner   uuid;
  v_current uuid;
  v_limit   int;
  v_count   int;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces
   WHERE id = p_space AND owner_id = auth.uid();
  IF v_owner IS NULL THEN
    RETURN; -- 空间不属于当前用户：静默跳过（与 0033 行为一致）
  END IF;

  -- 该设备当前登记在哪个空间（仅本用户的设备行可见）
  SELECT d.space_id INTO v_current
    FROM public.bsync_devices d
   WHERE d.id = p_device
     AND d.space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid());

  -- 仅「新设备首次登记」检查上限；心跳 / 换绑直接放行（存量设备不回收）
  IF v_current IS NULL THEN
    SELECT public.bsync_plan_device_limit(p.plan) INTO v_limit
      FROM public.bsync_profiles p WHERE p.user_id = auth.uid();
    v_limit := COALESCE(v_limit, 3);   -- profile 缺失按 free 兜底
    SELECT count(*) INTO v_count
      FROM public.bsync_devices d
      JOIN public.bsync_spaces s ON s.id = d.space_id
     WHERE s.owner_id = auth.uid();
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'device_limit_reached';
    END IF;
  END IF;

  INSERT INTO public.bsync_devices (id, space_id, name, app_version)
  VALUES (p_device, p_space, COALESCE(NULLIF(btrim(p_name), ''), p_device::text),
          NULLIF(btrim(p_app_version), ''))
  ON CONFLICT (id) DO UPDATE
    SET space_id     = excluded.space_id,   -- 换绑：设备随用户迁到新空间
        last_seen_at = now(),
        -- 0050：版本随心跳刷新；旧版扩展传 null 时保留原值，不清空
        app_version  = COALESCE(excluded.app_version, bsync_devices.app_version)
    -- 只改自己的设备行：同一 deviceId 若撞上别人的账号（UUID 碰撞），跳过而非篡改
    WHERE bsync_devices.space_id IN (
      SELECT id FROM bsync_spaces WHERE owner_id = auth.uid()
    );
END;
$$;

COMMENT ON FUNCTION public.bsync_device_touch(uuid, uuid, text, text) IS
'设备心跳 / 绑定：一台设备一行（主键 id），space_id 即本机绑定空间（换绑 = 更新它）。新设备首次登记时按计划检查设备数上限（free 3 / plus 6 / pro·lifetime 15），超限 raise device_limit_reached。0050 起额外写入 app_version（扩展版本，随心跳刷新）。';

-- ---------- 3) 授权（沿用 0039） ----------
REVOKE ALL ON FUNCTION public.bsync_device_touch(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.bsync_device_touch(uuid, uuid, text, text) TO authenticated;

-- ---------- 4) 后台详情：devices 增 app_version ----------
-- 在 0020 版基础上只增一个字段，其余（spaces / orders / 返回结构）不变。
create or replace function public.admin_get_user(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_profile record;
  v_sub     record;
  v_spaces  jsonb;
  v_devices jsonb;
  v_orders  jsonb;
  v_email   text;
begin
  perform public.assert_bsync_admin();

  select email into v_email from auth.users where id = p_user;
  select * into v_profile from public.bsync_profiles where user_id = p_user;
  select * into v_sub from public.bsync_subscriptions where user_id = p_user;

  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into v_spaces
    from (
      select s.id, s.name, s.is_default, s.created_at,
             (select count(*) from public.bsync_op_log o where o.space_id = s.id) as op_count,
             (select count(*) from public.bsync_devices d where d.space_id = s.id) as device_count
        from public.bsync_spaces s
       where s.owner_id = p_user
       order by s.is_default desc, s.created_at
    ) s;

  select coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) into v_devices
    from (
      select d.id, d.name, d.last_seen_at, s.name as space_name,
             d.app_version                    -- 0050
        from public.bsync_devices d
        join public.bsync_spaces s on s.id = d.space_id
       where s.owner_id = p_user
       order by d.last_seen_at desc
       limit 50
    ) d;

  select coalesce(jsonb_agg(row_to_json(o)), '[]'::jsonb) into v_orders
    from (
      select id, plan, amount_cents, currency, status, creem_order_id, created_at
        from public.bsync_orders
       where user_id = p_user
       order by created_at desc
       limit 20
    ) o;

  return jsonb_build_object(
    'user_id', p_user,
    'email', v_email,
    'profile', row_to_json(v_profile),
    'subscription', case when v_sub.user_id is null then null else row_to_json(v_sub) end,
    'spaces', v_spaces,
    'devices', v_devices,
    'recent_orders', v_orders
  );
end;
$$;

comment on function public.admin_get_user(uuid) is
'后台用户详情：profile / subscription / spaces / devices / recent_orders。0050 起 devices 每项含 app_version（扩展版本，用于判断用户停在哪个版本）。';
