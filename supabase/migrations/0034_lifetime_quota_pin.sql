-- ============================================================================
-- 0035 lifetime_quota_pin.sql — lifetime 档配额钉到 Pro 档（500MB）
-- 日期：2026-09-19
-- 背景：lifetime 是旧定价遗留的终身档（0013 保留枚举做兼容），属纯成本用户，
--       不再对外售卖。统一钉到 Pro 档配额（500MB ≈ 25 万条封顶），设备上限
--       走 bsync_plan_device_limit 的 lifetime 15 台（0033），之后不再单独
--       维护。仅抬高、不下调（quota_bytes < 500MB 才更新）。
-- 幂等性：UPDATE 带 WHERE，可安全重放。
-- 范围：仅 bsync_* 前缀（本租户）。
-- ============================================================================

UPDATE public.bsync_profiles SET quota_bytes = 524288000
WHERE plan = 'lifetime' AND quota_bytes < 524288000;
