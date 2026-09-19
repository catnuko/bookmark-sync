-- 0035_tighten_plan_byte_quota.sql — 收紧计划字节配额，使字节闸门与对外条数承诺对齐
-- ------------------------------------------------------------------
-- 背景（0032 遗留）：
--   E2EE 下服务端无法数条数，字节是唯一可服务端执行的口径（见 0032 头注）。
--   但 0032 的计划映射预留了过大余量：free 5MB ≈ 2500 条（承诺 500 条）、
--   plus 50MB ≈ 2.5 万条（承诺 10,000 条）——条数超限后同步依然成功，
--   「免费 500 条」实际不可执行。
--
-- 本次按 0034 的校准（500MB ≈ 25 万条 → 约 2KB/条）把映射对齐到条数承诺：
--   free  1MiB  ≈   500 条（承诺 500 条）
--   plus  20MiB ≈ 10,000 条（承诺 10,000 条）
--   pro / lifetime 500MiB 不变（数量不限档，字节仅作防滥用封顶 ≈ 25 万条）
--
-- 生效范围与兼容性：
--   * bsync_effective_quota_bytes 取 GREATEST(显式 quota_bytes, 计划映射)：
--     - 免费用户 profile.quota_bytes 默认 0 → 直接套用新映射；
--     - 存量付费用户的显式 quota_bytes（creem webhook 写入，0032 旧值）
--       取大保留，不回落（grandfathered）；新订阅走 webhook 新值。
--   * 拉取（op_pull / snapshot_pull）不做配额检查，超限只阻断新写入；
--     已同步数据不动，删除书签/空间释放容量后 bsync_quota_check 自动放行。
--   * 客户端（0032 起）已按 reason=quota_exceeded 区分档位提示：Free/Plus
--     弹升级引导，Pro 提示清理容量，无需客户端改动。
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
      ELSE 1048576                     -- free：1MiB ≈ 500 条
    END
  );
END; $$;

COMMENT ON FUNCTION public.bsync_effective_quota_bytes() IS
'当前用户有效字节配额：显式 quota_bytes 与计划映射取大（0035 校准：free 1MiB ≈ 500 条 / plus 20MiB ≈ 10,000 条 / pro·lifetime 500MB），与 bsync-creem-webhook 的 PLAN_QUOTA_BYTES 保持一致';
