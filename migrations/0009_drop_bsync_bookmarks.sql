-- 0009 废弃旧的 bsync_bookmarks 方案
-- 背景：远端迁移历史记录 0001 已执行，但远端实际不存在 bsync_bookmarks 表
--       （该表曾被手动删除，书签功能已迁移到 bsync_snapshots 快照方案）。
--       本迁移在全新环境 push 时废弃 0001 创建的旧表与旧函数，使
--       push 0001~0009 后的结果与远端现状一致。
-- 幂等：全部使用 if exists / cascade，重复执行安全。

-- 旧书签表（含其索引、策略、序列依赖一并删除）
drop table if exists public.bsync_bookmarks cascade;

-- 旧版同步函数（0001 创建，远端已删除）
drop function if exists public.bsync_sync_push(jsonb) cascade;
drop function if exists public.bsync_sync_pull(bigint) cascade;
