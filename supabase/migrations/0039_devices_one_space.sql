-- ============================================================================
-- 0039 devices_one_space.sql — 一台设备只属于一个空间（回退 0038 的复合主键）
-- 日期：2026-09-21
--
-- 背景：产品语义由「设备可绑多个空间、本机热切换」改为「**设备绑定空间**」
--       ——一个浏览器资料/一台设备只对应一个空间，本机书签树 ≡ 该空间。
--       0038 把主键改成 (space_id, id) 是为多容器并存服务的，现在不需要了：
--       同一 deviceId 在第二个空间再登记，只会让「设备列表」出现幽灵重复行，
--       并让设备数上限口径（count(DISTINCT d.id)）和实际设备数脱节。
--
-- 变更：
--   1. 同 id 去重（保留 last_seen_at 最新的一行），再拆掉复合主键、改建单列
--      主键 id —— 一台设备一行，换绑空间 = 更新 space_id。
--   2. bsync_device_touch：按 id upsert（含 space_id 更新），新设备首次登记时
--      按计划检查设备数上限（沿用 0033 的分档），计数简化为 count(*)。
--
-- 影响面：无外键引用 bsync_devices；RLS policy（0017）按 space_id 判定，单列
--         主键下依然成立。0020 的管理端统计不改（按 space_id 聚合仍正确）。
-- 幂等性：DO 块按 pg_constraint 实际定义判定，OR REPLACE 可安全重放。
-- 范围：仅 bsync_* 前缀（本租户）。
-- ============================================================================

-- ---------- 1) 去重 + 主键改回单列 id ----------
DO $$
DECLARE
  v_pk_name text;
  v_pk_cols text[];
BEGIN
  -- 1a) 同一 deviceId 若已在多个空间登记过（0038 时代的后果），
  --     只保留最近活跃的那一行，其余删掉。
  DELETE FROM public.bsync_devices d
   WHERE d.ctid <> (
     SELECT k.ctid
       FROM public.bsync_devices k
      WHERE k.id = d.id
      ORDER BY k.last_seen_at DESC, k.created_at DESC
      LIMIT 1
   );

  -- 1b) 读出当前主键定义
  SELECT c.conname,
         (SELECT array_agg(a.attname::text ORDER BY k.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
    INTO v_pk_name, v_pk_cols
    FROM pg_constraint c
   WHERE c.conrelid = 'public.bsync_devices'::regclass
     AND c.contype = 'p';

  -- 1c) 已是单列 id 主键则跳过（可重放）
  IF v_pk_cols IS DISTINCT FROM ARRAY['id'] THEN
    IF v_pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.bsync_devices DROP CONSTRAINT %I', v_pk_name);
    END IF;
    ALTER TABLE public.bsync_devices
      ADD CONSTRAINT bsync_devices_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- 按空间查设备（管理端设备列表 / 计数）仍走这条索引
CREATE INDEX IF NOT EXISTS bsync_devices_space_idx
  ON public.bsync_devices (space_id);

COMMENT ON TABLE public.bsync_devices IS
'同步设备：id 由客户端生成（UUID）。主键 id —— 一台设备只属于一个空间（本机书签树 ≡ 该空间），换绑空间即更新 space_id（0039 回退 0038 的复合主键）';

-- ---------- 2) bsync_device_touch：一设备一行，按 id upsert ----------
CREATE OR REPLACE FUNCTION public.bsync_device_touch(p_space uuid, p_device uuid, p_name text)
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

  INSERT INTO public.bsync_devices (id, space_id, name)
  VALUES (p_device, p_space, COALESCE(NULLIF(btrim(p_name), ''), p_device::text))
  ON CONFLICT (id) DO UPDATE
    SET space_id     = excluded.space_id,   -- 换绑：设备随用户迁到新空间
        last_seen_at = now()
    -- 只改自己的设备行：同一 deviceId 若撞上别人的账号（UUID 碰撞），跳过而非篡改
    WHERE bsync_devices.space_id IN (
      SELECT id FROM bsync_spaces WHERE owner_id = auth.uid()
    );
END;
$$;

COMMENT ON FUNCTION public.bsync_device_touch(uuid, uuid, text) IS
'设备心跳 / 绑定：一台设备一行（主键 id），space_id 即本机绑定空间（换绑 = 更新它）。新设备首次登记时按计划检查设备数上限（free 3 / plus 6 / pro·lifetime 15），超限 raise device_limit_reached（0039 调整；分档沿用 0033）';

-- ---------- 3) 授权（沿用）----------
REVOKE ALL ON FUNCTION public.bsync_device_touch(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.bsync_device_touch(uuid, uuid, text) TO authenticated;
