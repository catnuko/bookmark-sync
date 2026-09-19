-- ============================================================================
-- 0032 rate_limit_and_quota.sql — 热路径 RPC 限流 + 服务端字节配额执行（v2 补课）
-- 日期：2026-09-19
-- 背景：
--   1) 调用频次是账单上唯一没有硬顶的变量（Supabase invocation 按次计费）。
--      JWT / RLS 挡住匿名与跨用户，但认证用户可脚本化高频调用 push / pull
--      放大调用账单。加每用户固定窗口限流（60 秒窗口，每用户一行）。
--      阈值：push 60 次/分（客户端一次 flushPush 一批）、pull 120 次/分
--      （分页 1000 行/次，2 万行回放 ≈ 20 次）、restore 12 次/分（快照全量
--      重建属重操作）。正常客户端（30 分钟轮询 + 事件去抖 2 秒）余量 ≥60 倍。
--   2) v1 的字节配额执行（0014/0015）随 0017 v2 重构被移除：v2 的
--      bsync_op_push 无配额检查、bsync_profiles.used_bytes 从不更新，客户端
--      store.js 的 quota_exceeded 分支是死代码 → 定价档位（Free 5MB /
--      Plus 50MB / Pro 500MB）一直没有服务端闸门。本迁移补回：
--        - used_bytes 实时聚合口径 = op_log.op + snapshots.data 的
--          octet_length（E2EE 下服务端无法数条数，字节是唯一可执行口径，
--          与 webhook PLAN_QUOTA_BYTES 常量对齐）
--        - op_push 写入前检查，超额 raise 'quota_exceeded'
--          （message 即 reason，与 spaceRpcError / store.js 约定一致）
--        - 推送 / GC 后回写 used_bytes（供后台视图与扩展配额卡展示）
--   3) quota_bytes 缺省值 0（0017）会让新注册用户额度为 0：改列默认 5MB
--      并回填存量 0 值行；执行口径走 bsync_effective_quota_bytes()
--      （计划映射为下限，webhook / 后台写入的显式值可抬高）。
-- 幂等性：可安全重放（CREATE IF NOT EXISTS / OR REPLACE / ALTER IF NOT EXISTS）。
-- 范围：仅 bsync_* 前缀（本租户）。
-- ============================================================================

-- ---------- 1) 限流桶（每用户一行，固定 60 秒窗口） ----------
CREATE TABLE IF NOT EXISTS public.bsync_call_buckets (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start  timestamptz NOT NULL DEFAULT now(),
  push_count    int NOT NULL DEFAULT 0,
  pull_count    int NOT NULL DEFAULT 0,
  restore_count int NOT NULL DEFAULT 0
);
ALTER TABLE public.bsync_call_buckets ENABLE ROW LEVEL SECURITY;
-- 无策略（默认全拒）：仅经 SECURITY DEFINER 函数读写，客户端不可直查（TENANTS #4）
REVOKE ALL ON public.bsync_call_buckets FROM anon, authenticated;
COMMENT ON TABLE public.bsync_call_buckets IS
'每用户 RPC 调用限流桶（60 秒固定窗口）：仅 bsync_rate_limit 内部读写，无 RLS 策略即客户端不可见';

-- ---------- 2) 限流判定（SECURITY DEFINER，超限 raise 'rate_limited'） ----------
CREATE OR REPLACE FUNCTION public.bsync_rate_limit(p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_limit int;
  v_count int;
BEGIN
  -- 未登录调用交由各 RPC 自行拒绝，这里不消耗桶
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  v_limit := CASE p_kind
    WHEN 'push'    THEN 60
    WHEN 'pull'    THEN 120
    WHEN 'restore' THEN 12
    ELSE 0
  END;
  IF v_limit = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.bsync_call_buckets AS b
    (user_id, window_start, push_count, pull_count, restore_count)
  VALUES (
    v_user, now(),
    CASE WHEN p_kind = 'push'    THEN 1 ELSE 0 END,
    CASE WHEN p_kind = 'pull'    THEN 1 ELSE 0 END,
    CASE WHEN p_kind = 'restore' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    -- 窗口过期则重置起点与对应计数；b.* 引用旧行
    window_start = CASE WHEN b.window_start < now() - interval '60 seconds'
                        THEN now() ELSE b.window_start END,
    push_count   = CASE WHEN b.window_start < now() - interval '60 seconds'
                        THEN (CASE WHEN p_kind = 'push' THEN 1 ELSE 0 END)
                        ELSE b.push_count + (CASE WHEN p_kind = 'push' THEN 1 ELSE 0 END) END,
    pull_count   = CASE WHEN b.window_start < now() - interval '60 seconds'
                        THEN (CASE WHEN p_kind = 'pull' THEN 1 ELSE 0 END)
                        ELSE b.pull_count + (CASE WHEN p_kind = 'pull' THEN 1 ELSE 0 END) END,
    restore_count = CASE WHEN b.window_start < now() - interval '60 seconds'
                        THEN (CASE WHEN p_kind = 'restore' THEN 1 ELSE 0 END)
                        ELSE b.restore_count + (CASE WHEN p_kind = 'restore' THEN 1 ELSE 0 END) END
  RETURNING
    CASE p_kind
      WHEN 'push' THEN push_count
      WHEN 'pull' THEN pull_count
      ELSE restore_count
    END
  INTO v_count;

  IF v_count > v_limit THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;
END; $$;
COMMENT ON FUNCTION public.bsync_rate_limit(text) IS
'每用户 60 秒固定窗口限流：push 60/分、pull 120/分、restore 12/分；超限 raise rate_limited（0032）';

-- ---------- 3) 有效配额（字节） ----------
-- 显式 quota_bytes（webhook / 后台设置）优先，否则按计划映射；
-- 与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES 保持一致。
CREATE OR REPLACE FUNCTION public.bsync_effective_quota_bytes()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prof public.bsync_profiles;
BEGIN
  SELECT * INTO v_prof FROM public.bsync_profiles WHERE user_id = auth.uid();
  RETURN GREATEST(
    v_prof.quota_bytes,
    CASE v_prof.plan
      WHEN 'plus'     THEN 52428800    -- 50MB
      WHEN 'pro'      THEN 524288000   -- 500MB
      WHEN 'lifetime' THEN 524288000
      ELSE 5242880                     -- free：5MB
    END
  );
END; $$;
COMMENT ON FUNCTION public.bsync_effective_quota_bytes() IS
'当前用户有效字节配额：显式 quota_bytes 与计划映射取大（free 5MB / plus 50MB / pro·lifetime 500MB）';

-- ---------- 4) 用量聚合 / 回写 / 检查 ----------
-- 实时聚合：op_log + snapshots 的序列化字节（跨本人所有空间）
CREATE OR REPLACE FUNCTION public.bsync_used_bytes_now()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_bytes bigint;
BEGIN
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;
  SELECT
    COALESCE((SELECT sum(octet_length(o.op::text)) FROM public.bsync_op_log o
               JOIN public.bsync_spaces s ON s.id = o.space_id
              WHERE s.owner_id = v_user), 0)
    + COALESCE((SELECT sum(octet_length(sn.data::text)) FROM public.bsync_snapshots sn
               JOIN public.bsync_spaces s ON s.id = sn.space_id
              WHERE s.owner_id = v_user), 0)
  INTO v_bytes;
  RETURN v_bytes;
END; $$;
COMMENT ON FUNCTION public.bsync_used_bytes_now() IS
'当前用户实时字节用量（op_log.op + snapshots.data 的 octet_length，本人全部空间）；E2EE 下唯一可服务端执行的口径';

-- 回写 used_bytes（推送 / GC 后调用，供后台视图与配额卡）
CREATE OR REPLACE FUNCTION public.bsync_quota_refresh()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_bytes bigint;
BEGIN
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;
  v_bytes := public.bsync_used_bytes_now();
  UPDATE public.bsync_profiles SET used_bytes = v_bytes WHERE user_id = v_user;
  RETURN v_bytes;
END; $$;
COMMENT ON FUNCTION public.bsync_quota_refresh() IS
'聚合并回写 bsync_profiles.used_bytes（不检查配额，GC 等缩减型操作也可调用）';

-- 检查 + 回写：used + p_extra 超过有效配额时 raise 'quota_exceeded'
CREATE OR REPLACE FUNCTION public.bsync_quota_check(p_extra bigint DEFAULT 0)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_used bigint;
BEGIN
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;
  -- 惰性建 profile（与 bsync_get_profile 一致），保证配额默认值存在
  INSERT INTO public.bsync_profiles (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO NOTHING;
  v_used := public.bsync_used_bytes_now();
  UPDATE public.bsync_profiles SET used_bytes = v_used WHERE user_id = v_user;
  IF v_used + GREATEST(p_extra, 0) > public.bsync_effective_quota_bytes() THEN
    RAISE EXCEPTION 'quota_exceeded';
  END IF;
  RETURN v_used;
END; $$;
COMMENT ON FUNCTION public.bsync_quota_check(bigint) IS
'字节配额检查：used_bytes(聚合) + p_extra > 有效配额时 raise quota_exceeded；同时回写 used_bytes';

-- ---------- 5) bsync_op_push：限流 + 配额（0024 版本为基础） ----------
CREATE OR REPLACE FUNCTION public.bsync_op_push(p_space uuid, p_device uuid, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows int;
  v_owner uuid;
  v_gc_needed boolean := false;
  v_extra bigint;
BEGIN
  PERFORM public.bsync_rate_limit('push');
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('inserted', 0, 'denied', true);
  END IF;
  -- 本次待写入字节（加密 op 包络的序列化大小），写入前检查
  SELECT COALESCE(sum(octet_length(elem->'op'::text)), 0) INTO v_extra
    FROM jsonb_array_elements(p_ops) elem;
  PERFORM public.bsync_quota_check(v_extra);
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
  -- 回写 used_bytes（含本次写入，供后台视图 / 配额卡）
  PERFORM public.bsync_quota_refresh();
  RETURN jsonb_build_object('inserted', v_rows, 'gc_needed', v_gc_needed);
END; $$;
COMMENT ON FUNCTION public.bsync_op_push(uuid, uuid, jsonb) IS
'批量追加 Move-CRDT 操作日志（按 space+device+seq 幂等去重）；限流 + 字节配额检查（超额 raise quota_exceeded）+ 响应带 gc_needed（0032）';

-- ---------- 6) bsync_op_pull：限流（0024 版本为基础） ----------
CREATE OR REPLACE FUNCTION public.bsync_op_pull(p_space uuid, p_after_id bigint, p_limit int DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_rows jsonb;
  v_last bigint;
  v_more boolean;
  v_gc_needed boolean := false;
BEGIN
  PERFORM public.bsync_rate_limit('pull');
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
COMMENT ON FUNCTION public.bsync_op_pull(uuid, bigint, int) IS
'按全局游标拉取增量操作日志（id 升序，分页，含 has_more）；限流 + 响应带 gc_needed（0032）';

-- ---------- 7) bsync_snapshot_pull：限流（0018 版本为基础） ----------
CREATE OR REPLACE FUNCTION public.bsync_snapshot_pull(p_space uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_owner uuid;
  v_snap public.bsync_snapshots;
BEGIN
  PERFORM public.bsync_rate_limit('restore');
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
COMMENT ON FUNCTION public.bsync_snapshot_pull(uuid) IS
'返回空间最新 GC 快照（{id, after_op_id, data, created_at}），无则 NULL；data 为加密投影；限流（0032）';

-- ---------- 8) bsync_op_maybe_gc：限流 + GC 后回写用量（0024 版本为基础） ----------
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
  PERFORM public.bsync_rate_limit('restore');
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
  -- GC 是缩减型操作：只回写用量，不做配额检查（超额用户必须仍能 GC 减量）
  PERFORM public.bsync_quota_refresh();
  RETURN jsonb_build_object('gced', true, 'deleted', v_deleted, 'snapshot_id', v_snap_id, 'needed', true);
END; $$;
COMMENT ON FUNCTION public.bsync_op_maybe_gc(uuid, jsonb, int) IS
'GC 入口：服务端判定是否执行（用户动态阈值或后台请求），客户端仅提供加密投影；限流 + 回写用量（0032）';

-- ---------- 9) 配额缺省值与回填 ----------
-- 新 profile 默认 Free 5MB（0017 的默认 0 会让新用户额度为 0）
ALTER TABLE public.bsync_profiles ALTER COLUMN quota_bytes SET DEFAULT 5242880;
-- 存量 0 值行按计划回填（与 webhook PLAN_QUOTA_BYTES 对齐）
UPDATE public.bsync_profiles SET quota_bytes =
  CASE plan
    WHEN 'plus'     THEN 52428800
    WHEN 'pro'      THEN 524288000
    WHEN 'lifetime' THEN 524288000
    ELSE 5242880
  END
WHERE quota_bytes <= 0;

-- ---------- 10) 授权（显式、最小化） ----------
REVOKE ALL ON FUNCTION public.bsync_rate_limit(text)              FROM anon;
REVOKE ALL ON FUNCTION public.bsync_effective_quota_bytes()       FROM anon;
REVOKE ALL ON FUNCTION public.bsync_used_bytes_now()              FROM anon;
REVOKE ALL ON FUNCTION public.bsync_quota_refresh()               FROM anon;
REVOKE ALL ON FUNCTION public.bsync_quota_check(bigint)           FROM anon;
REVOKE ALL ON FUNCTION public.bsync_op_push(uuid, uuid, jsonb)    FROM anon;
REVOKE ALL ON FUNCTION public.bsync_op_pull(uuid, bigint, int)    FROM anon;
REVOKE ALL ON FUNCTION public.bsync_snapshot_pull(uuid)           FROM anon;
REVOKE ALL ON FUNCTION public.bsync_op_maybe_gc(uuid, jsonb, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.bsync_op_push(uuid, uuid, jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.bsync_op_pull(uuid, bigint, int)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.bsync_snapshot_pull(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.bsync_op_maybe_gc(uuid, jsonb, int) TO authenticated;

-- ---------- 11) 收回业务表直写权限（配额执行的前置条件） ----------
-- 漏洞：0017 起 bsync_profiles 等表的 RLS 策略为 owner FOR ALL，且未收回
--       anon/authenticated 的表级 DML 授权 → 登录用户可经 Data API 直改
--       自己的 plan / quota_bytes（自提权绕过全部付费闸门）、直插 op_log /
--       devices / spaces 绕过配额与设备上限。
-- 修复：收回业务表 DML（写入一律走 SECURITY DEFINER RPC / 触发器 /
--       service_role webhook，客户端代码只直读，不受影响——见 src 直读清单：
--       spaces / devices / op_log / profiles(plan 列) / subscriptions 均仅 SELECT）。
--       bsync_waitlist（官网申请表单直插）与 bsync_admins 不在收权范围。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_profiles      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_spaces        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_devices       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_op_log        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_snapshots     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_orders        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bsync_subscriptions FROM anon, authenticated;
