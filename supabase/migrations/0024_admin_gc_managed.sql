-- ============================================================================
-- 0024：服务端托管 GC —— 用户动态阈值 + 后台请求 GC
-- 日期：2026-09-17
-- 背景：GC 阈值不再由客户端配置（该概念对终端用户太陌生）。改为：
--   - bsync_profiles 增加 gc_threshold（0 = 按计划默认：free 2000 / pro 20000）、
--     gc_requested（后台手动请求 GC 标记）、last_gc_at（最近一次 GC 时间）
--   - bsync_op_push / bsync_op_pull 响应带 gc_needed，客户端据此自动配合
--     （仍需客户端提供 E2EE 加密投影，服务端无法独立生成）
--   - bsync_op_maybe_gc 改为服务端判定是否执行 GC，忽略客户端传入的阈值
--   - 后台新增 admin_get_gc_stats / admin_set_gc_threshold / admin_request_gc
--   - admin_system_stats 扩展：待 GC 用户数、超阈值空间数
-- 幂等性：可安全重放（ADD COLUMN IF NOT EXISTS / OR REPLACE）。
-- 范围：仅 bsync_* 前缀（本租户）。
-- ============================================================================

-- ---------- 1) bsync_profiles 新列 ----------
ALTER TABLE public.bsync_profiles
  ADD COLUMN IF NOT EXISTS gc_threshold bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gc_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_gc_at timestamptz;

COMMENT ON COLUMN public.bsync_profiles.gc_threshold IS '用户 GC 阈值（op_log 行数），0 = 按计划默认（free 2000 / pro 20000），后台可调';
COMMENT ON COLUMN public.bsync_profiles.gc_requested IS '后台请求 GC 标记：置 true 后该用户设备下次同步自动执行压缩';
COMMENT ON COLUMN public.bsync_profiles.last_gc_at IS '最近一次服务端执行 GC 的时间';

-- ---------- 2) 当前用户有效 GC 阈值（内部，供 push/pull/maybe_gc 判定） ----------
CREATE OR REPLACE FUNCTION public.bsync_gc_threshold()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prof public.bsync_profiles;
BEGIN
  SELECT * INTO v_prof FROM public.bsync_profiles WHERE user_id = auth.uid();
  IF v_prof.gc_threshold > 0 THEN
    RETURN v_prof.gc_threshold;
  END IF;
  IF v_prof.plan IN ('pro', 'lifetime') THEN
    RETURN 20000;
  END IF;
  RETURN 2000;
END; $$;
COMMENT ON FUNCTION public.bsync_gc_threshold() IS '当前用户有效 GC 阈值：显式设置优先，否则按计划默认（free 2000 / pro、lifetime 20000）';

-- ---------- 3) bsync_op_push：响应带 gc_needed ----------
CREATE OR REPLACE FUNCTION public.bsync_op_push(p_space uuid, p_device uuid, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows int; v_owner uuid; v_gc_needed boolean := false;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('inserted', 0, 'denied', true);
  END IF;
  INSERT INTO public.bsync_op_log (space_id, device_id, seq, op, cid)
  SELECT p_space, p_device, (elem->>'seq')::bigint, elem->'op', elem->>'cid'
  FROM jsonb_array_elements(p_ops) elem
  ON CONFLICT (space_id, device_id, seq) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- 服务端判定是否需要 GC（行数 > 用户动态阈值，或后台已请求）
  SELECT count(*) > public.bsync_gc_threshold() INTO v_gc_needed
    FROM public.bsync_op_log WHERE space_id = p_space;
  IF NOT v_gc_needed THEN
    SELECT EXISTS(SELECT 1 FROM public.bsync_profiles
                   WHERE user_id = v_owner AND gc_requested) INTO v_gc_needed;
  END IF;
  RETURN jsonb_build_object('inserted', v_rows, 'gc_needed', v_gc_needed);
END; $$;
COMMENT ON FUNCTION public.bsync_op_push(uuid, uuid, jsonb) IS '批量追加 Move-CRDT 操作日志（按 space+device+seq 幂等去重）；响应带 gc_needed 供客户端自动配合 GC';

-- ---------- 4) bsync_op_pull：响应带 gc_needed ----------
CREATE OR REPLACE FUNCTION public.bsync_op_pull(p_space uuid, p_after_id bigint, p_limit int DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_rows jsonb; v_last bigint; v_more boolean; v_gc_needed boolean := false;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('denied', true);
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT id, device_id, seq, op, cid, created_at
        FROM public.bsync_op_log
        WHERE space_id = p_space AND id > p_after_id
        ORDER BY id LIMIT p_limit) t;
  SELECT COALESCE(max(id), p_after_id) INTO v_last FROM public.bsync_op_log
    WHERE space_id = p_space AND id > p_after_id;
  SELECT EXISTS(SELECT 1 FROM public.bsync_op_log
                WHERE space_id = p_space AND id > v_last) INTO v_more;
  SELECT count(*) > public.bsync_gc_threshold() INTO v_gc_needed
    FROM public.bsync_op_log WHERE space_id = p_space;
  IF NOT v_gc_needed THEN
    SELECT EXISTS(SELECT 1 FROM public.bsync_profiles
                   WHERE user_id = v_owner AND gc_requested) INTO v_gc_needed;
  END IF;
  RETURN jsonb_build_object('rows', v_rows, 'last_id', v_last, 'has_more', COALESCE(v_more, false), 'gc_needed', v_gc_needed);
END; $$;
COMMENT ON FUNCTION public.bsync_op_pull(uuid, bigint, int) IS '按全局游标拉取增量操作日志（id 升序，分页，含 has_more）；响应带 gc_needed 供客户端自动配合 GC';

-- ---------- 5) bsync_op_maybe_gc：服务端判定，忽略客户端阈值 ----------
CREATE OR REPLACE FUNCTION public.bsync_op_maybe_gc(
  p_space uuid,
  p_projection jsonb,
  p_threshold int DEFAULT -1
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_count bigint;
  v_max_id bigint;
  v_snap_id bigint;
  v_deleted bigint;
  v_gc_needed boolean := false;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('denied', true, 'gced', false, 'deleted', 0, 'snapshot_id', null);
  END IF;
  -- 同空间 GC 串行化（防并发 GC 相互删快照导致基线丢失）
  PERFORM pg_advisory_xact_lock(hashtext('bsync_gc:' || p_space::text));
  SELECT count(*), COALESCE(max(id), 0) INTO v_count, v_max_id
    FROM public.bsync_op_log WHERE space_id = p_space;
  -- 服务端判定：行数超过用户动态阈值，或后台已请求 GC（p_threshold 参数仅兼容旧客户端，不再使用）
  SELECT count(*) > public.bsync_gc_threshold() INTO v_gc_needed
    FROM public.bsync_op_log WHERE space_id = p_space;
  IF NOT v_gc_needed THEN
    SELECT EXISTS(SELECT 1 FROM public.bsync_profiles
                   WHERE user_id = v_owner AND gc_requested) INTO v_gc_needed;
  END IF;
  IF NOT v_gc_needed THEN
    RETURN jsonb_build_object('gced', false, 'deleted', 0, 'snapshot_id', null, 'needed', false);
  END IF;
  -- 落快照（after_op_id = 当前最大 op id；data 为客户端加密投影）
  INSERT INTO public.bsync_snapshots (space_id, after_op_id, data)
  VALUES (p_space, v_max_id, p_projection)
  RETURNING id INTO v_snap_id;
  -- 截断：删 id <= 快照水位的 op
  DELETE FROM public.bsync_op_log WHERE space_id = p_space AND id <= v_max_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  -- 只保留最新快照（防止快照无限增长）
  DELETE FROM public.bsync_snapshots
   WHERE space_id = p_space AND id <> v_snap_id;
  -- 记录 GC 时间并清除后台请求标记
  UPDATE public.bsync_profiles SET last_gc_at = now(), gc_requested = false
   WHERE user_id = v_owner;
  RETURN jsonb_build_object('gced', true, 'deleted', v_deleted, 'snapshot_id', v_snap_id, 'needed', true);
END; $$;
COMMENT ON FUNCTION public.bsync_op_maybe_gc(uuid, jsonb, int) IS 'GC 入口：由服务端判定是否执行（用户动态阈值或后台请求），客户端仅提供加密投影；p_threshold 仅兼容旧客户端、被忽略';

-- ============================================================================
-- 后台管理 RPC
-- ============================================================================

-- 单用户 GC 监控统计（元数据，不解密书签）
CREATE OR REPLACE FUNCTION public.admin_get_gc_stats(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text;
  v_prof public.bsync_profiles;
  v_effective bigint;
  v_spaces jsonb;
BEGIN
  PERFORM public.assert_bsync_admin();
  SELECT email INTO v_email FROM auth.users WHERE id = p_user;
  SELECT * INTO v_prof FROM public.bsync_profiles WHERE user_id = p_user;
  v_effective := CASE
    WHEN v_prof.gc_threshold > 0 THEN v_prof.gc_threshold
    WHEN v_prof.plan IN ('pro', 'lifetime') THEN 20000
    ELSE 2000
  END;
  SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb) INTO v_spaces
    FROM (
      SELECT s.id, s.name, s.is_default,
             (SELECT count(*) FROM public.bsync_op_log o WHERE o.space_id = s.id) AS op_count,
             (SELECT octet_length(snap.data::text) FROM public.bsync_snapshots snap
               WHERE snap.space_id = s.id ORDER BY snap.id DESC LIMIT 1) AS snapshot_bytes,
             (SELECT snap.after_op_id FROM public.bsync_snapshots snap
               WHERE snap.space_id = s.id ORDER BY snap.id DESC LIMIT 1) AS snapshot_after_op_id,
             (SELECT snap.created_at FROM public.bsync_snapshots snap
               WHERE snap.space_id = s.id ORDER BY snap.id DESC LIMIT 1) AS snapshot_created_at
        FROM public.bsync_spaces s
       WHERE s.owner_id = p_user
       ORDER BY s.is_default DESC, s.created_at
    ) s;
  RETURN jsonb_build_object(
    'user_id', p_user,
    'email', v_email,
    'profile', jsonb_build_object(
      'plan', v_prof.plan,
      'used_count', v_prof.used_count,
      'gc_threshold', v_prof.gc_threshold,
      'effective_gc_threshold', v_effective,
      'gc_requested', v_prof.gc_requested,
      'last_gc_at', v_prof.last_gc_at
    ),
    'spaces', v_spaces
  );
END; $$;
COMMENT ON FUNCTION public.admin_get_gc_stats(uuid) IS '后台单用户 GC 监控：有效阈值/最近 GC/后台请求状态 + 各空间 op 行数/快照体积/快照水位（仅元数据，不解密）';

-- 设置用户 GC 阈值（0 = 恢复按计划默认）
CREATE OR REPLACE FUNCTION public.admin_set_gc_threshold(p_user uuid, p_threshold bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_bsync_admin();
  IF p_threshold < 0 THEN
    RAISE EXCEPTION 'gc threshold must be >= 0';
  END IF;
  UPDATE public.bsync_profiles SET gc_threshold = p_threshold WHERE user_id = p_user;
  INSERT INTO public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  VALUES (auth.uid(), 'set_gc_threshold', p_user, jsonb_build_object('gc_threshold', p_threshold));
END; $$;
COMMENT ON FUNCTION public.admin_set_gc_threshold(uuid, bigint) IS '后台设置用户 GC 阈值（0 = 恢复按计划默认）；写审计日志';

-- 请求对某用户执行 GC（设备下次同步自动响应；快照投影必须由客户端生成）
CREATE OR REPLACE FUNCTION public.admin_request_gc(p_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_bsync_admin();
  UPDATE public.bsync_profiles SET gc_requested = true WHERE user_id = p_user;
  INSERT INTO public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  VALUES (auth.uid(), 'request_gc', p_user, jsonb_build_object('requested', true));
END; $$;
COMMENT ON FUNCTION public.admin_request_gc(uuid) IS '后台请求对指定用户执行 GC：置 gc_requested，设备下次同步自动压缩并清除标记；写审计日志';

-- ---------- 6) admin_system_stats：扩展监控统计 ----------
CREATE OR REPLACE FUNCTION public.admin_system_stats()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_oplog_rows      bigint;
  v_oplog_bytes     bigint;
  v_snapshot_count  bigint;
  v_top_users       jsonb;
  v_recent_gc       timestamptz;
  v_pending_gc      bigint;
  v_over_threshold  bigint;
BEGIN
  PERFORM public.assert_bsync_admin();

  SELECT count(*), COALESCE(sum(pg_column_size(op)), 0)
    INTO v_oplog_rows, v_oplog_bytes
    FROM public.bsync_op_log;

  SELECT count(*) INTO v_snapshot_count FROM public.bsync_snapshots;

  SELECT max(created_at) INTO v_recent_gc FROM (
    SELECT s.created_at FROM public.bsync_snapshots s ORDER BY s.id DESC LIMIT 1
  ) t;

  -- 待 GC 用户数（后台已请求但设备尚未响应）
  SELECT count(*) INTO v_pending_gc FROM public.bsync_profiles WHERE gc_requested;

  -- 超过各自有效阈值的空间数（op 行数 > 用户阈值，说明 GC 待执行）
  SELECT count(*) INTO v_over_threshold FROM (
    SELECT o.space_id
      FROM public.bsync_op_log o
      JOIN public.bsync_spaces s ON s.id = o.space_id
      JOIN public.bsync_profiles p ON p.user_id = s.owner_id
     GROUP BY o.space_id, p.gc_threshold, p.plan
    HAVING count(*) > CASE
             WHEN p.gc_threshold > 0 THEN p.gc_threshold
             WHEN p.plan IN ('pro', 'lifetime') THEN 20000
             ELSE 2000 END
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_users
    FROM (
      SELECT sp.owner_id AS user_id, u.email,
             count(o.id) AS oplog_rows,
             COALESCE(sum(pg_column_size(o.op)), 0) AS oplog_bytes
        FROM public.bsync_op_log o
        JOIN public.bsync_spaces sp ON sp.id = o.space_id
        LEFT JOIN auth.users u ON u.id = sp.owner_id
       GROUP BY sp.owner_id, u.email
       ORDER BY oplog_bytes DESC
       LIMIT 10
    ) t;

  RETURN jsonb_build_object(
    'oplog_rows', v_oplog_rows,
    'oplog_bytes', v_oplog_bytes,
    'snapshot_count', v_snapshot_count,
    'latest_snapshot_at', v_recent_gc,
    'pending_gc_users', v_pending_gc,
    'over_threshold_spaces', v_over_threshold,
    'top_users', v_top_users
  );
END; $$;
COMMENT ON FUNCTION public.admin_system_stats() IS
'系统监控：op_log 总量/字节、快照数、最近 GC 时间、待 GC 用户数、超阈值空间数、op_log 占用 Top10 用户（仅元数据，不解密）';

-- ---------- 7) 授权 ----------
REVOKE ALL ON FUNCTION public.admin_get_gc_stats(uuid)        FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_gc_threshold(uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.admin_request_gc(uuid)          FROM anon;
REVOKE ALL ON FUNCTION public.admin_system_stats()            FROM anon;

GRANT EXECUTE ON FUNCTION public.admin_get_gc_stats(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_gc_threshold(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_request_gc(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_system_stats()            TO authenticated;
