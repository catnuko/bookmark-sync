-- ============================================================================
-- 0046 fix op_pull pagination.sql — 修正 bsync_op_pull 的分页游标（数据丢失级）
-- 日期：2026-10-01
--
-- 现象（2026-10-01 线上实测，空间 op 数 1509）：
--   客户端冷启动全量重放只拿到 1000 条就停了：
--     [bsync] 拉取: applied=1000 skipped=0 afterId=7201
--     （第二轮 applied=0 —— 水位已推到末尾，剩下 509 条**永远不会再被拉取**）
--
-- 根因（0032 版 bsync_op_pull，本迁移修的就是这一行）：
--   SELECT COALESCE(max(id), p_after_id) INTO v_last FROM public.bsync_op_log
--     WHERE space_id = p_space AND id > p_after_id;        -- ← 没有 LIMIT
--   `v_last` 本意是「本页最后一条的 id」= 下一页的游标，但这条查询扫的是
--   **全部**匹配行，于是取到的是**全局最大 id**。下一页判断
--   `has_more = EXISTS(id > v_last)` 因此恒为 false → 客户端把水位直接推到
--   末尾，`LIMIT p_limit` 之外的行被永久跳过。
--
-- 影响面：**任何 op 数 > 1000（p_limit 默认值）的空间**，冷启动重放
--   （SW 被回收后 bare replica / 新设备首次同步）都只能拿到前 1000 条。
--   正常情况下 GC 快照会把 op 日志压短从而掩盖这个问题，但「GC 需要先有
--   一次成功同步」——恰好被这个 bug 卡住的空间会一直拿不到快照，形成死锁。
--
-- 修法：把 v_last 改成「**本页**的 max(id)」。`has_more` 的判据
--   （EXISTS(id > v_last)）本来就是对的，不用动。
--   顺带给 p_limit 加兜底（null / <=0 → 1000），否则 `LIMIT NULL` 等于不限量，
--   又会退化成「一页拉完」，把分页语义重新抹掉。
--
-- 幂等性：CREATE OR REPLACE，可安全重放。
-- ============================================================================

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

  -- 兜底：LIMIT NULL 等于不限量，会把分页语义抹掉（见文件头）
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1000;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT id, device_id, seq, op, cid, created_at
        FROM public.bsync_op_log
        WHERE space_id = p_space AND id > p_after_id
        ORDER BY id LIMIT p_limit) t;

  -- ★ 本页游标：只在本页范围内取 max(id)（0046 修正点）。
  --   0032 版在这里漏了子查询，取到的是全表最大 id，导致 has_more 恒 false。
  SELECT COALESCE(max(t.id), p_after_id) INTO v_last
  FROM (SELECT id FROM public.bsync_op_log
        WHERE space_id = p_space AND id > p_after_id
        ORDER BY id LIMIT p_limit) t;

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
'按全局游标拉取增量操作日志（id 升序，分页，含 has_more）；last_id 为**本页**最后一条的 id（0046 修正：0032 版误取全表最大 id，导致 >1000 条 op 的空间只拉到第一页）；限流 + 响应带 gc_needed（0032）';

-- ============================================================================
-- 自检 SQL（执行后复核）
--
--   -- 造一个 >1000 条 op 的空间不现实，改为直接验证「本页游标」语义：
--   -- 取一个小 limit，检查 last_id 落在本页范围内、has_more 为 true。
--   --   select public.bsync_op_pull('<space>', 0, 10);
--   --   期望：last_id = 本页第 10 条的 id（而非全局最大 id）；has_more = true
--   -- 再拉一页，确认游标推进且不重复：
--   --   select public.bsync_op_pull('<space>', <上一步 last_id>, 10);
--   --   期望：rows[0].id > 上一步 last_id
--
--   -- 回归判据（本次线上事故的直接特征）：对 op 数 > 1000 的空间，
--   -- 反复分页直到 has_more=false，累计行数应等于 count(*)。
-- ============================================================================
