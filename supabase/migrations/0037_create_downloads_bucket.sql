-- 0037_create_downloads_bucket.sql — 创建官网安装包分发 bucket（public）
-- ------------------------------------------------------------------
-- 用途：release.yml 发版时把 bookmark-sync-{chromium,firefox}-<ver>.zip
--       和 latest.json 上传到本 bucket，官网下载页（DownloadView）运行时
--       读 latest.json 生成下载链接。仓库不再提交 zip 二进制。
--
-- 说明：
--   * storage.buckets 属于 Supabase Storage 系统表，用迁移建桶是官方支持
--     的做法（Dashboard 手建亦可，但迁移让配置进仓库、可审查可重建）。
--   * public = true：/storage/v1/object/public/downloads/... 匿名可读，
--     服务于官网访客下载（TENANTS.md 第 5 条的例外是有意的，仅限本桶）。
--   * 不建任何写策略：anon / authenticated 均无上传权限，写路径仅
--     service_role（GitHub Actions secret，见 release.yml 上传步骤）。
--   * 对象按版本化文件名写入（永不覆盖旧版本），latest.json 用 x-upsert 覆盖。
-- ------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('downloads', 'downloads', true)
ON CONFLICT (id) DO UPDATE SET public = true;
