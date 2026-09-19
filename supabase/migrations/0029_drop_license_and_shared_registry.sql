-- ============================================================================
-- 0029 drop_license_and_shared_registry.sql — 拆除 license 子系统与多租户共享层
-- 日期：2026-09-19
-- 背景：本项目收敛为 bsync（bookmark-sync）单租户。license 子系统（卡密计费）
--       与共享注册表（projects/project_members/profiles/余额函数）不再被任何
--       bsync 对象引用：
--         - assert_bsync_admin / admin_whoami 已于 0028 改查 bsync_admins；
--         - bsync-creem-webhook 已摘除 lic_user_profiles 同步写入；
--       全部数据为测试数据（用户确认），直接拆除。
-- 逻辑保留：license 系统的建表/函数逻辑在本仓库 git 历史中永久保留
--       （0008 基线、0011 lic_ 前缀重命名等迁移 + functions/ 源码，恢复时在
--       新项目重放相关迁移并部署函数即可）。本迁移只拆运行时对象，不动历史。
-- 顺带：0008 遗留的授权问题（anon 全权限、authenticated 含 TRUNCATE 等）
--       随对象删除一并消失；bsync_* 全部表/函数不受影响。
-- 幂等性：drop if exists / cascade，可安全重放。
-- 范围：仅无前缀共享对象与 lic_* 前缀对象；不动任何 bsync_*。
-- ============================================================================

-- ---------- 1) license 子系统表 ----------
drop table if exists public.lic_user_profiles cascade;
drop table if exists public.lic_user_tokens   cascade;
drop table if exists public.lic_usage_logs    cascade;
drop table if exists public.lic_licenses      cascade;

-- ---------- 2) 共享注册表与余额（先依赖后主体） ----------
drop table if exists public.profiles        cascade;
drop table if exists public.project_members cascade;
drop table if exists public.projects        cascade;

-- ---------- 3) license / 余额 / 注册表函数 ----------
drop function if exists public.lic_consume_license(uuid, text);
drop function if exists public.lic_extend_license(uuid, text, integer);
drop function if exists public.lic_consume_token(text);
drop function if exists public.add_balance(uuid, numeric);
drop function if exists public.consume_balance(uuid, numeric);
drop function if exists public.get_balance(uuid);
drop function if exists public.ensure_membership(uuid);
drop function if exists public.is_project_member(uuid);

-- 0028 起管理员判定改查 bsync_admins，此常量函数失去调用方
drop function if exists public.bsync_admin_project_id();
