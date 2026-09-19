-- ============================================================================
-- 0033 device_limit.sql — 设备数量按计划上限（Free 3 / Plus 6 / Pro·Lifetime 15）
-- 日期：2026-09-19
-- 背景：设备数三档均不限时，每台设备每月约 1,440 次 30 分钟轮询（invocation
--       计费）+ 新设备全量恢复（配额级 egress），设备数是成本的主要放大器，
--       也是账号共享的主要通道。改为按计划限制：
--         free 3 / plus 6 / pro·lifetime 15（未知计划按 free 3 兜底）
--       仅在「新设备首次登记」时检查（心跳 / 已登记设备不受限，存量设备不
--       回收，不惩罚老用户）。计数口径 = 用户全部空间下去重设备数
--       （同一设备在多个空间登记只计一台）。
--       超限 raise 'device_limit_reached'（message 即 reason，客户端
--       spaceRpcError / store.js 映射为升级引导）。
-- 已知边界：并发登记两台新设备可能同时通过计数检查（±1 容忍，单用户低并发，
--       不为此引入锁）。用户可经 bsync_device_remove 自助移除旧设备腾位。
-- 幂等性：OR REPLACE，可安全重放。
-- 范围：仅 bsync_* 前缀（本租户）。
-- ============================================================================

-- ---------- 1) 计划 → 设备上限 ----------
CREATE OR REPLACE FUNCTION public.bsync_plan_device_limit(p_plan text)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'plus'     THEN 6
    WHEN 'pro'      THEN 15
    WHEN 'lifetime' THEN 15
    ELSE 3               -- free 及未知计划
  END;
END; $$;
COMMENT ON FUNCTION public.bsync_plan_device_limit(text) IS
'计划 → 设备数上限映射：free 3 / plus 6 / pro·lifetime 15，未知计划按 3（0033）';

-- ---------- 2) bsync_device_touch：新设备登记时检查（0031 版本为基础） ----------
CREATE OR REPLACE FUNCTION public.bsync_device_touch(p_space uuid, p_device uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bsync_spaces WHERE id = p_space AND owner_id = auth.uid()) THEN
    RETURN;
  END IF;
  -- 仅新设备首次登记检查配额；心跳 / 已登记设备直接放行（存量设备不回收）
  IF NOT EXISTS (SELECT 1 FROM public.bsync_devices WHERE space_id = p_space AND id = p_device) THEN
    SELECT public.bsync_plan_device_limit(p.plan) INTO v_limit
      FROM public.bsync_profiles p WHERE p.user_id = auth.uid();
    v_limit := COALESCE(v_limit, 3);   -- profile 缺失按 free 兜底
    SELECT count(DISTINCT d.id) INTO v_count
      FROM public.bsync_devices d
      JOIN public.bsync_spaces s ON s.id = d.space_id
     WHERE s.owner_id = auth.uid();
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'device_limit_reached';
    END IF;
  END IF;
  INSERT INTO public.bsync_devices (id, space_id, name)
  VALUES (p_device, p_space, COALESCE(NULLIF(btrim(p_name), ''), p_device::text))
  ON CONFLICT (space_id, id) DO UPDATE SET last_seen_at = now();
END;
$$;

-- ---------- 3) 授权与注释 ----------
REVOKE ALL ON FUNCTION public.bsync_device_touch(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.bsync_device_touch(uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.bsync_device_touch(uuid, uuid, text) IS
'设备心跳：登记或刷新 last_seen_at；name 仅首次登记生效（0031）；新设备首次登记时按计划检查设备数上限（free 3 / plus 6 / pro·lifetime 15），超限 raise device_limit_reached（0033）';
