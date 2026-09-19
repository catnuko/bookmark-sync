-- 0036_reset_explicit_quota_bytes.sql — 清零存量显式配额，统一由 0035 计划映射接管
-- ------------------------------------------------------------------
-- 背景：bsync-creem-webhook 自 0032 起给订阅/降级用户写入显式 quota_bytes
-- （旧口径 free 5MB / plus 50MB），而 bsync_effective_quota_bytes 取
-- GREATEST(显式值, 计划映射) → 0035 收紧映射后，存量用户仍按旧高值生效。
--
-- 当前库内均为测试数据（产品未上线，用户已确认可清除），统一清零显式值：
--   free      → 映射 1MiB（≈500 条）
--   plus      → 映射 20MiB（≈10,000 条）
--   pro       → 映射 500MiB（与 0034 lifetime 钉值一致）
--   lifetime  → 映射 500MiB（与 0034 钉值一致，效果不变）
-- 此后显式配额仅由 webhook 按新口径写入；used_bytes 无需处理，
-- bsync_quota_check / bsync_quota_refresh 会在下次推送时回写。
-- ------------------------------------------------------------------

UPDATE public.bsync_profiles SET quota_bytes = 0 WHERE quota_bytes <> 0;
