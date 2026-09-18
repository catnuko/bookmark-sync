-- ============================================================================
-- 0027 tighten_project_members_insert.sql — 收紧 project_members 写入权限（修提权漏洞）
-- 日期：2026-09-19
-- 背景：0008 基线化的 pm_insert_self 策略只校验 user_id = auth.uid()，未限制
--       project_id。任何登录用户可把自己插入任意项目（含 bsync 管理员项目
--       885e7f27-f4ad-447d-8f17-e18fac1dcf0a），从而通过 assert_bsync_admin()
--       （0020）自封后台管理员，获得 admin_* RPC 全部能力（用户邮箱、订单、
--       改套餐、重置用户数据、GC 控制、审计日志）。已实测远端策略现状一致。
-- 修复：
--   1) pm_insert_self 收紧为「只能把自己加进自己 owner 的项目」，与
--      projects_insert_own（owner_id = auth.uid()）对齐；角色范围从 public
--      收窄到 authenticated（anon 本就过不了 auth.uid() 校验，显式化）。
--   2) revoke authenticated 的 TRUNCATE / REFERENCES / TRIGGER / UPDATE /
--      DELETE：RLS 不拦截 TRUNCATE，原全量表权限等于任何登录用户可清空
--      全表（所有租户的成员关系）；UPDATE / DELETE 本就无对应策略（RLS 拒绝），
--      一并收回做最小化授权（规范第 5 条）。SELECT / INSERT 保留。
-- 影响：多租户共享表，所有租户生效。service_role 不受 RLS 与 revoke 影响，
--       边缘函数（均走 service_role）不受影响；仓库内无客户端直插
--       project_members 的调用方。既有成员行不受 INSERT 策略影响。
-- 幂等性：drop + create / revoke 幂等，可安全重放。
-- 范围：仅共享表 project_members 的 RLS 策略与授权；不动表结构与其它策略。
--       遗留：0008 其余基线表（profiles / user_tokens / lic_* 等）的
--       authenticated 全量授权同样含 TRUNCATE，待后续迁移统一收紧。
-- ============================================================================

drop policy if exists pm_insert_self on public.project_members;
create policy pm_insert_self on public.project_members
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and exists (
            select 1 from public.projects p
            where p.id = project_id
              and p.owner_id = auth.uid()
        )
    );

revoke update, delete, truncate, references, trigger
    on public.project_members from authenticated;
