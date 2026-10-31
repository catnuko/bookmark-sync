-- ============ 0054 本地验证：反馈 → GitHub issue 同步链路（占位 token） ============
-- 依赖：**supabase 本地栈**（需要真实 vault 与 pg_net，裸 Postgres 重放跑不了本文件）。
-- 运行：
--   supabase start
--   supabase db reset          # 或 supabase migration up（应用 0001~0054）
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f scripts/verify-sync-local/scenario-0054-github-issue-sync.sql
-- 预期：载荷形状断言全过；网络链路用**占位 token** 实测 —— GitHub 返回 401
--       （Bad credentials）即证明请求已发出、已到达 api.github.com、Bearer 头已带上。
--       换真 token 后同一链路应得 201（连通复测由人工执行）。
-- 断言风格与 scenario-0045 一致：预期不符 raise exception（ON_ERROR_STOP 终止，退出码非 0）。
\set ON_ERROR_STOP on

\echo '--- [0] 幂等准备：重置测试用户与 vault secret（占位 token） ---'
delete from public.bsync_feedback where user_id = '45111111-1111-1111-1111-111111111154';
insert into auth.users (id, email)
values ('45111111-1111-1111-1111-111111111154', 'fb-sync@test')
on conflict (id) do update set email = excluded.email;
do $$ begin
  perform vault.remove_secret(id) from vault.secrets where name = 'github_feedback_pat';
exception when undefined_table or invalid_schema_name then
  raise exception 'vault schema 不存在：请在 supabase 本地栈运行本脚本（裸 Postgres 不含 vault）';
end $$;
select vault.create_secret('ghp_placeholder_local_test_token', 'github_feedback_pat') as secret_id;

\echo '--- [1] role-play：authenticated 提交一条 bug 反馈（触发器应异步建 issue） ---'
set role authenticated;
select set_config('request.jwt.claim.sub', '45111111-1111-1111-1111-111111111154', false);
select (public.bsync_submit_feedback(
          'bug', E'同步后条目位置不对\n希望按文件夹排序', 'User@Example.com',
          '2.7.0', 'Chrome 137', 'zh-CN', 'sync')->>'ok')::boolean as ok;   -- 期望 true
reset role;

\echo '--- [2] 载荷形状断言（纯函数，不经网络） ---'
do $$
declare
  v_payload jsonb;
  v_title   text;
begin
  select public.bsync_feedback_issue_payload(f) into v_payload
    from public.bsync_feedback f
   where user_id = '45111111-1111-1111-1111-111111111154';
  if v_payload is null then
    raise exception 'UNEXPECTED: 反馈行不存在';
  end if;

  v_title := v_payload->>'title';
  if v_title not like '[bug] %' then
    raise exception 'UNEXPECTED: title 应以 [bug] 开头，实际 %', v_title;
  end if;
  if position(E'\n' in v_title) <> 0 then
    raise exception 'UNEXPECTED: title 不应含换行，实际 %', v_title;
  end if;
  if length(v_title) > 66 then
    raise exception 'UNEXPECTED: title 应 ≤ 66 字符（前缀+60），实际 %', length(v_title);
  end if;
  if v_payload->'labels' <> jsonb_build_array('bug') then
    raise exception 'UNEXPECTED: labels 应为 ["bug"]，实际 %', v_payload->'labels';
  end if;
  if (v_payload->>'body') not like '%同步后条目位置不对%希望按文件夹排序%' then
    raise exception 'UNEXPECTED: body 应含反馈全文（含换行原文）';
  end if;
  if (v_payload->>'body') not like '%回信邮箱: user@example.com%'
     or (v_payload->>'body') not like '%账号邮箱: fb-sync@test%'
     or (v_payload->>'body') not like '%插件版本: 2.7.0%'
     or (v_payload->>'body') not like '%平台: Chrome 137%'
     or (v_payload->>'body') not like '%语言: zh-CN%'
     or (v_payload->>'body') not like '%最近错误阶段: sync%' then
    raise exception 'UNEXPECTED: body 缺少白名单元数据/邮箱，实际 %', v_payload->>'body';
  end if;
  raise notice 'OK: 载荷形状正确（title/labels/全文/元数据/邮箱）';
end $$;

\echo '--- [3] 等待 pg_net 异步投递完成（≤20s） ---'
do $$
declare
  n int := 0;
begin
  while n < 20 loop
    if exists (
      select 1 from net.http_response
       where created > now() - interval '1 minute'
         and url like '%api.github.com/repos/catnuko/bookmark-sync-feedback/issues%'
    ) then
      exit;
    end if;
    perform pg_sleep(1);
    n := n + 1;
  end loop;
end $$;

\echo '--- [4] 链路断言：占位 token → GitHub 401（证明请求已达、Bearer 头已带上） ---'
do $$
declare
  r record;
begin
  select status_code, content::text as body, error_msg, timed_out
    into r
    from net.http_response
   where url like '%api.github.com/repos/catnuko/bookmark-sync-feedback/issues%'
   order by id desc
   limit 1;
  if not found then
    raise exception 'UNEXPECTED: net.http_response 未见请求记录（pg_net 未发出请求或未落响应）';
  end if;
  if r.status_code is null then
    raise exception 'UNEXPECTED: 请求未得到 HTTP 响应（error=%, timed_out=%）——检查容器出网',
      r.error_msg, r.timed_out;
  end if;
  if r.status_code <> 401 then
    raise exception 'UNEXPECTED: 占位 token 期望 401，实际 % —— %', r.status_code, left(r.body, 200);
  end if;
  if r.body not like '%"message"%' then
    raise exception 'UNEXPECTED: 响应应为 GitHub JSON 错误体，实际 %', left(r.body, 200);
  end if;
  raise notice 'OK: 链路通 —— GitHub 返回 401（Bad credentials），换真 token 后应为 201';
end $$;

\echo '--- [5] role-play 负例（TENANTS #10）：客户端角色调不到载荷/触发器函数 ---'
set role authenticated;
select set_config('request.jwt.claim.sub', '45111111-1111-1111-1111-111111111154', false);
DO $$
BEGIN
  PERFORM public.bsync_feedback_issue_payload(
    (select f from public.bsync_feedback f
      where user_id = '45111111-1111-1111-1111-111111111154' limit 1));
  RAISE EXCEPTION 'UNEXPECTED: authenticated 可调 bsync_feedback_issue_payload';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 载荷函数对 authenticated 已收回';
  WHEN OTHERS THEN RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
END $$;
DO $$
BEGIN
  PERFORM public.bsync_feedback_to_github_issue();
  RAISE EXCEPTION 'UNEXPECTED: authenticated 可调触发器函数';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 触发器函数对 authenticated 已收回';
  WHEN OTHERS THEN RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
END $$;
reset role;

\echo '--- [6] 收尾：清掉占位 secret（本地不留凭据） ---'
select vault.remove_secret(id) from vault.secrets where name = 'github_feedback_pat';

\echo '=== 0054 本地验证全部通过 ==='
