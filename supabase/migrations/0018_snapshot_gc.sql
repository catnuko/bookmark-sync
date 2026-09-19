-- 0018 snapshot_gc.sql — 操作日志快照 + GC（P3 产品化）
-- 背景：Move-CRDT 操作日志（bsync_op_log）无限增长。本迁移启用
--       bsync_snapshots 作为 GC 截断后的重建基线：
--         - 行数超阈值时客户端调用 bsync_op_maybe_gc：落快照（加密投影）→
--           截断 op_log（id <= 快照水位）→ 仅保留最新快照。
--         - 落后设备拉取时先 bsync_snapshot_pull 拿最新快照重建，再增量拉 op。
--       used_count 口径改为客户端上报（快照加密后服务端无法自算书签数）：
--         - bsync_profiles 新增 used_count 列；客户端同步后
--           bsync_profile_set_used 上报；bsync_get_profile 直接读列。
-- 幂等性：可安全重放（ADD COLUMN IF NOT EXISTS / OR REPLACE）。
-- 范围：仅 bsync_* 前缀（本租户）。

-- ---------- 1) bsync_profiles.used_count（客户端上报口径） ----------
ALTER TABLE public.bsync_profiles ADD COLUMN IF NOT EXISTS used_count bigint NOT NULL DEFAULT 0;

-- 当前用户资料：used_count 读列（不再从快照明文统计——快照已加密）
CREATE OR REPLACE FUNCTION public.bsync_get_profile()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_profile public.bsync_profiles;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_profile FROM public.bsync_profiles WHERE user_id = v_user;
  IF v_profile.user_id IS NULL THEN
    INSERT INTO public.bsync_profiles (user_id) VALUES (v_user) RETURNING * INTO v_profile;
  END IF;
  RETURN jsonb_build_object(
    'user_id', v_profile.user_id,
    'plan', v_profile.plan,
    'quota_bytes', v_profile.quota_bytes,
    'used_bytes', v_profile.used_bytes,
    'purchased_at', v_profile.purchased_at,
    'used_count', v_profile.used_count
  );
END; $$;
COMMENT ON FUNCTION public.bsync_get_profile() IS '当前用户资料；used_count 由客户端同步后上报（0018 起，快照加密后服务端不自算）';

-- 客户端上报本机书签数（快照加密后服务端无法自算）
CREATE OR REPLACE FUNCTION public.bsync_profile_set_used(p_used bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bsync_profiles (user_id, used_count)
  VALUES (auth.uid(), p_used)
  ON CONFLICT (user_id) DO UPDATE SET used_count = EXCLUDED.used_count;
END; $$;
COMMENT ON FUNCTION public.bsync_profile_set_used(bigint) IS '客户端同步后上报本机书签条数（used_count 口径，仅属主）';

-- ---------- 2) 快照拉取（落后设备重建基线） ----------
CREATE OR REPLACE FUNCTION public.bsync_snapshot_pull(p_space uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_snap public.bsync_snapshots;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_snap FROM public.bsync_snapshots
   WHERE space_id = p_space ORDER BY id DESC LIMIT 1;
  IF v_snap.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_snap.id,
    'after_op_id', v_snap.after_op_id,
    'data', v_snap.data,
    'created_at', v_snap.created_at
  );
END; $$;
COMMENT ON FUNCTION public.bsync_snapshot_pull(uuid) IS '返回空间最新 GC 快照（{id, after_op_id, data, created_at}），无则 NULL；data 为加密投影';

-- ---------- 3) GC：行数超阈值 → 落快照 + 截断 + 清旧快照 ----------
CREATE OR REPLACE FUNCTION public.bsync_op_maybe_gc(p_space uuid, p_threshold int, p_projection jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_count bigint;
  v_max_id bigint;
  v_snap_id bigint;
  v_deleted bigint;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('denied', true, 'gced', false, 'deleted', 0, 'snapshot_id', null);
  END IF;
  -- 同空间 GC 串行化（防并发 GC 相互删快照导致基线丢失）
  PERFORM pg_advisory_xact_lock(hashtext('bsync_gc:' || p_space::text));
  SELECT count(*), COALESCE(max(id), 0) INTO v_count, v_max_id
    FROM public.bsync_op_log WHERE space_id = p_space;
  IF v_count <= p_threshold THEN
    RETURN jsonb_build_object('gced', false, 'deleted', 0, 'snapshot_id', null);
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
  RETURN jsonb_build_object('gced', true, 'deleted', v_deleted, 'snapshot_id', v_snap_id);
END; $$;
COMMENT ON FUNCTION public.bsync_op_maybe_gc(uuid, int, jsonb) IS 'op_log 行数超阈值时：落快照（加密投影）→ 截断 op_log → 仅保留最新快照；返回 {gced, deleted, snapshot_id}';
