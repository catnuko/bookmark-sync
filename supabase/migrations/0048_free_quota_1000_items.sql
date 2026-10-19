-- 0048_free_quota_1000_items.sql — 免费档：条数 500 → 1,000，字节 1MiB → 5MiB
-- ------------------------------------------------------------------
-- 背景：免费档对外承诺 500 条，按 2KB/条 校准对应 1MiB（0035）。现提到
-- 1,000 条，字节配额同步上调。
--
-- 为什么是 5MiB 而不是 2MiB（按 2KB/条 刚好够 1,000 条）：
--   1) 实测真实用户 1,297 条只占 685KB（≈0.53KB/条），2KB/条 是长标题 /
--      长 URL / 深嵌套的保守校准，留 5MiB 能让 1,000 条在最坏情况下也宽裕；
--   2) **顺带消除一处长期分裂**：0032 把 quota_bytes 列默认值设成 5MiB，
--      0035 却把计划映射改成 1MiB，而 bsync_effective_quota_bytes 取
--      GREATEST(列值, 计划映射) —— 0036 之后新注册的免费账号（列值 5MiB）
--      实际有 5MiB，存量/降级账号（列值 0 或 1MiB）却只有 1MiB。同一档位
--      两种额度，后台上也看不出原因。映射改成 5MiB 后两边归一。
--
-- 生效范围：
--   * 存量免费账号：GREATEST 取 5MiB，立即生效，无需回填数据；
--   * 降级路径写入的显式 1MiB（2026-10-08 退款扫描 / 0044 里写死的 1048576，
--     都是已提交的历史迁移、按规定不改）被 5MiB 覆盖 —— GREATEST 取大，
--     降级用户同样拿到 5MiB，不会按旧值被压回去；
--   * 拉取（op_pull / snapshot_pull）不做配额检查，超限只阻断新写入，
--     已同步数据不动；删除书签 / 空间释放容量后 bsync_quota_check 自动放行。
--   * plus / pro / lifetime 映射不变。
--
-- 条数闸门（1,000）在客户端执行，见 src/sync/syncEngine.ts 的 itemLimit。
-- ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bsync_effective_quota_bytes()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prof public.bsync_profiles;
BEGIN
  SELECT * INTO v_prof FROM public.bsync_profiles WHERE user_id = auth.uid();
  RETURN GREATEST(
    v_prof.quota_bytes,
    CASE v_prof.plan
      WHEN 'plus'     THEN 20971520    -- 20MiB ≈ 10,000 条（2KB/条 校准，对齐宣传条数）
      WHEN 'pro'      THEN 524288000   -- 500MB
      WHEN 'lifetime' THEN 524288000
      ELSE 5242880                     -- free：5MiB（1,000 条，含长书签余量）
    END
  );
END; $$;

COMMENT ON FUNCTION public.bsync_effective_quota_bytes() IS
'当前用户有效字节配额：显式 quota_bytes 与计划映射取大（0048：free 5MiB ≈ 1,000 条 / plus 20MiB ≈ 10,000 条 / pro·lifetime 500MB），与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES 保持一致';
