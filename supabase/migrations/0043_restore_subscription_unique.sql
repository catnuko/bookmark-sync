-- 0043_restore_subscription_unique.sql — 补回 bsync_subscriptions 的 creem_subscription_id 唯一约束
-- ------------------------------------------------------------------
-- 背景（0017 重建时丢的）：
--   0013 建 bsync_subscriptions 时 `creem_subscription_id text not null unique`；
--   0017 为了 v2 迁移 `DROP TABLE IF EXISTS public.bsync_subscriptions CASCADE` 后
--   `CREATE TABLE IF NOT EXISTS` 重建，重建的 DDL 里**漏了这个 unique**（也漏了
--   0013 的 plan / status CHECK）。线上表因此只剩 `pkey(user_id)` + 外键。
--
-- 后果（已用 e2e 场景 `creem-webhook` 复现，报 42P10）：
--   `bsync-creem-webhook` 的开通分支是
--     `upsert({...}, { onConflict: 'creem_subscription_id' })`
--   PostgREST 会发 `ON CONFLICT (creem_subscription_id) DO UPDATE`，而没有对应唯一
--   索引时 PG 直接报 `42P10: there is no unique or exclusion constraint matching the
--   ON CONFLICT specification`。supabase-js 不把这类错误当异常抛，于是：
--     * 订阅行**永远写不进去**（webhook 返回 200，看起来一切正常）；
--     * `bsync-creem-portal` 按 `user_id` 查不到 `creem_customer_id` → 付费用户
--       在客户门户里被告知「当前账号没有订阅记录，无需管理」→ **无法自助取消**；
--     * `subscription.scheduled_cancel / past_due / canceled` 等按
--       `creem_subscription_id` 更新，全部影响 0 行 → 本地订阅状态不再跟随 Creem；
--     * metadata 缺失时「按订阅 id 反查 user_id」这条兜底也失效。
--   注意 `bsync_profiles` 的翻档发生在 upsert **之后**且不检查错误，所以现象是
--   「付了钱确实开通了，但订阅台账是空的」——只坏售后，不坏开通，因此更难发现。
--
-- 本次只补 unique，**不补回 plan / status 的 CHECK**：
--   webhook 会把 Creem 的原始 status 原样落库（`subObj.status || 'active'`），而
--   0013 那份 CHECK 的枚举里没有 `trialing`，而 webhook 恰恰订阅了
--   `subscription.trialing` —— 补回去会把试用订阅写失败，属于把旧坑重新挖开。
--
-- 幂等：先删重复（按 updated_at 留最新）再建唯一索引，可安全重放。
-- ------------------------------------------------------------------

-- 1) 清重复：唯一索引建不上去时，先按「保留 updated_at 最新的一条」去重。
--    线上目前必然无重复（约束缺失期间根本写不进订阅行），这段是为「先修约束、
--    后补历史数据」以及全量重放的场景兜底。
DELETE FROM public.bsync_subscriptions a
 USING public.bsync_subscriptions b
 WHERE a.creem_subscription_id IS NOT NULL
   AND a.creem_subscription_id = b.creem_subscription_id
   AND (a.updated_at, a.user_id) < (b.updated_at, b.user_id);

-- 2) 补唯一索引。PG 里 `ON CONFLICT (col)` 认的是**唯一索引**（唯一约束也是靠唯一
--    索引实现的），所以这里用 CREATE UNIQUE INDEX 即可命中，且 IF NOT EXISTS 幂等。
CREATE UNIQUE INDEX IF NOT EXISTS bsync_subscriptions_creem_subscription_id_key
    ON public.bsync_subscriptions (creem_subscription_id);

COMMENT ON INDEX public.bsync_subscriptions_creem_subscription_id_key IS
'Creem 订阅 id 唯一（0013 有、0017 重建表时丢失）。bsync-creem-webhook 的 upsert(onConflict:creem_subscription_id) 依赖它，缺失时报 42P10 导致订阅台账写不进去';
