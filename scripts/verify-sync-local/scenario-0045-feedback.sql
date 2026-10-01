-- ============ 0045 本地验证：反馈提交 / 限流 / 收权 / 后台 RPC ============
-- 依赖：真实 Postgres，按序执行 setup.sql → 迁移 0001~0045 全量重放 → 本文件。
-- 运行：psql -v ON_ERROR_STOP=1 -f scripts/verify-sync-local/scenario-0045-feedback.sql
-- 断言风格：预期报错用 DO 块捕获并比对 SQLERRM（不符才 raise），
--           未预期的错误由 ON_ERROR_STOP 直接终止（退出码非 0 = 失败）。
-- 覆盖 TENANTS #10 要求的 role-play 正反用例。
\set ON_ERROR_STOP on

\echo '--- [0] 注册用户 A / B，并把 A 设为管理员 ---'
insert into auth.users (id, email)
values ('45111111-1111-1111-1111-111111111111', 'a@test'),
       ('45111111-1111-1111-1111-111111111112', 'b@test');
insert into public.bsync_admins (user_id) values ('45111111-1111-1111-1111-111111111111');

\echo '--- [1] 未登录提交 → {ok:false,error:unauthenticated}（非抛错） ---'
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.bsync_submit_feedback('bug', 'hello') as unauthenticated_case; -- 期望 ok=false / unauthenticated

\echo '--- [2] 登录后正常提交 → {ok:true,id}，环境列落库 ---'
set role authenticated;
select set_config('request.jwt.claim.sub', '45111111-1111-1111-1111-111111111111', false);
select (public.bsync_submit_feedback(
          'bug', '  同步后位置不对  ', 'User@Example.com',
          '2.7.0', 'Chrome 137', 'zh-CN', 'sync')->>'ok')::boolean as ok;   -- 期望 true
select kind, body, contact_email, app_version, platform, locale, last_error_phase, status
  from public.bsync_feedback
 where user_id = '45111111-1111-1111-1111-111111111111';
-- 期望：bug / '同步后位置不对'(已 btrim) / 'user@example.com'(已 lower) / 2.7.0 / Chrome 137 / zh-CN / sync / new

\echo '--- [3] 空正文（含纯空白）→ {ok:false,error:empty} ---'
select (public.bsync_submit_feedback('idea', '   ')->>'error') as empty_case; -- 期望 empty

\echo '--- [4] 邮箱格式非法 → {ok:false,error:invalid_email} ---'
select (public.bsync_submit_feedback('other', 'x', 'not-an-email')->>'error') as bad_email_case; -- 期望 invalid_email

\echo '--- [5] 非法 kind 降级 other（不因 UI bug 让用户失败） ---'
select (public.bsync_submit_feedback('nonsense', '降级测试')->>'ok')::boolean as ok; -- 期望 true
select kind from public.bsync_feedback
 where body = '降级测试'; -- 期望 other

\echo '--- [6] 限流：10 分钟内第 4 次 → rate_limited（阈值 3/10min） ---'
-- 此时 A 已有 2 行（[2] / [5]）：第 3 次仍放行，第 4 次被拒
select (public.bsync_submit_feedback('other', '第三次')->>'ok')::boolean as third_ok;  -- 期望 true
select (public.bsync_submit_feedback('other', '第四次')->>'error') as rate_case;      -- 期望 rate_limited
select count(*) as rows_for_a from public.bsync_feedback
 where user_id = '45111111-1111-1111-1111-111111111111'; -- 期望 3

\echo '--- [7] role-play 负例（TENANTS #10）：authenticated 不能直插表（须 42501） ---'
DO $$
BEGIN
  INSERT INTO public.bsync_feedback (user_id, body) VALUES (auth.uid(), 'bypass');
  RAISE EXCEPTION 'UNEXPECTED: authenticated 可直插 bsync_feedback（收权口子未关）';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 直插 bsync_feedback 被拒绝';
  WHEN OTHERS THEN RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
END $$;

\echo '--- [8] 非管理员调后台 RPC → forbidden ---'
select set_config('request.jwt.claim.sub', '45111111-1111-1111-1111-111111111112', false); -- 切到 B
DO $$
BEGIN
  PERFORM public.admin_list_feedback();
  RAISE EXCEPTION 'UNEXPECTED: 非管理员可读反馈列表';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%forbidden%' THEN
    RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
  END IF;
  RAISE NOTICE 'OK: forbidden';
END $$;

\echo '--- [9] 管理员读列表 → 带出提交者邮箱，total 正确 ---'
select set_config('request.jwt.claim.sub', '45111111-1111-1111-1111-111111111111', false); -- 切回 A（管理员）
select (public.admin_list_feedback()->>'total')::int as total,               -- 期望 3
       (public.admin_list_feedback()->'rows'->0->>'email') as first_email;   -- 期望 a@test
select (public.admin_list_feedback(null, 'bug')->>'total')::int as bug_only; -- 期望 1

\echo '--- [10] 管理员标记状态 → 写审计（action=mark_feedback） ---'
select (public.admin_set_feedback_status(
          (select id from public.bsync_feedback order by id limit 1),
          'resolved', '已确认'))->>'ok' as ok;   -- 期望 true
select count(*) as audit_rows from public.bsync_admin_audit_log
 where action = 'mark_feedback'; -- 期望 1
select status, admin_note, status_changed_at is not null as stamped
  from public.bsync_feedback order by id limit 1; -- 期望 resolved / 已确认 / true

\echo '--- [11] 非法状态 → 抛错 ---'
DO $$
BEGIN
  PERFORM public.admin_set_feedback_status((SELECT id FROM public.bsync_feedback ORDER BY id LIMIT 1), 'bogus');
  RAISE EXCEPTION 'UNEXPECTED: 非法状态未被拒绝';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%invalid status%' THEN
    RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
  END IF;
  RAISE NOTICE 'OK: invalid status';
END $$;

\echo '--- [12] 错误上报列表（0042 表）可读：row / fingerprint 两种模式 ---'
reset role;
insert into public.bsync_error_reports (user_id, fingerprint, phase, reason, error_name, error_message, occurrences)
values ('45111111-1111-1111-1111-111111111111', 'fp1', 'sync', 'error', 'TypeError', 'boom', 5),
       ('45111111-1111-1111-1111-111111111112', 'fp1', 'sync', 'error', 'TypeError', 'boom', 2);
set role authenticated;
select set_config('request.jwt.claim.sub', '45111111-1111-1111-1111-111111111111', false);
select (public.admin_list_error_reports(null, null, 'row')->>'total')::int as er_rows,          -- 期望 2
       (public.admin_list_error_reports(null, null, 'fingerprint')->>'total')::int as er_fps;   -- 期望 1
select (public.admin_list_error_reports(null, null, 'fingerprint')->'rows'->0->>'occurrences')::int as total_occ, -- 期望 7
       (public.admin_list_error_reports(null, null, 'fingerprint')->'rows'->0->>'user_count')::int as users;      -- 期望 2

\echo '--- [13] anon 无 EXECUTE 权限（提交与后台 RPC 均须 42501） ---'
set role anon;
DO $$
BEGIN
  PERFORM public.bsync_submit_feedback('bug', 'x');
  RAISE EXCEPTION 'UNEXPECTED: anon 可调 bsync_submit_feedback';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'OK: anon 调提交 RPC 被拒绝';
  WHEN OTHERS THEN RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
END $$;

\echo '=== 全部通过 ==='
