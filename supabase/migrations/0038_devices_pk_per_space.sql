-- ============================================================================
-- 0038 devices_pk_per_space.sql — 设备主键改按空间：一台设备可登记到多个空间
-- 日期：2026-09-20
--
-- 背景：0017 建表时把 `id` 写成单列 PRIMARY KEY，同时又声明 UNIQUE (space_id, id)，
--       两条约束语义矛盾 → 同一 deviceId 无法在第二个空间登记。表现为切换空间后
--       bsync_device_touch（0033 版本）走 INSERT 时撞 bsync_devices_pkey 抛
--       23505 duplicate key；而客户端 src/sync.js 只识别 device_limit_reached，
--       该错误被静默吞掉：目标空间没有设备行 → 设备列表缺台、设备数上限口径漏算、
--       「解除绑定」删掉的是另一个空间的行。
--       0033 的注释与实现（count(DISTINCT d.id) JOIN bsync_spaces，「同一设备在
--       多个空间登记只计一台」）已明确设计意图为多对多，故按空间复合主键修正。
--
-- 影响面：无任何外键引用 bsync_devices（op_log.device_id 未建 FK），改主键不牵连
--         其它表；存量数据每行 id 本就全局唯一，加复合主键不会冲突。
-- 幂等性：DO 块按 pg_constraint 的实际定义判定，重复执行无副作用。
-- 范围：仅 bsync_* 前缀（本租户）。
-- ============================================================================

DO $$
DECLARE
  v_pk_name  text;
  v_pk_cols  text[];
  v_con_name text;
BEGIN
  -- 读出当前主键的名字与列集合
  SELECT c.conname,
         (SELECT array_agg(a.attname::text ORDER BY k.ord)
            FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
    INTO v_pk_name, v_pk_cols
    FROM pg_constraint c
   WHERE c.conrelid = 'public.bsync_devices'::regclass
     AND c.contype = 'p';

  -- 1) 只在「旧形态：主键仅 id 一列」时拆掉它（已修好的库跳过，保证可重放）
  IF v_pk_cols = ARRAY['id'] THEN
    EXECUTE format('ALTER TABLE public.bsync_devices DROP CONSTRAINT %I', v_pk_name);
    v_pk_cols := NULL;
  END IF;

  -- 2) 补 (space_id, id) 复合主键
  IF v_pk_cols IS NULL THEN
    ALTER TABLE public.bsync_devices
      ADD CONSTRAINT bsync_devices_pkey PRIMARY KEY (space_id, id);
  END IF;

  -- 3) 删除与新主键完全重复的 UNIQUE 约束（0017 的 UNIQUE (space_id, id)）
  FOR v_con_name IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.bsync_devices'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = k.attnum)
           = ARRAY['space_id', 'id']
  LOOP
    EXECUTE format('ALTER TABLE public.bsync_devices DROP CONSTRAINT %I', v_con_name);
  END LOOP;
END $$;

COMMENT ON TABLE public.bsync_devices IS
'同步设备：id 由客户端生成（UUID），用于操作日志的来源标识与设备管理。主键 (space_id, id)：同一台设备可登记到多个空间（0038 修正 0017 的单列主键，对齐 0033「同一设备在多个空间登记只计一台」的计数口径）';
