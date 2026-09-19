-- ============ 0032~0034 本地验证：限流 / 字节配额 / 设备上限 / 收权 ============
-- 依赖：真实 Postgres，按序执行 setup.sql → 迁移 0001~0034 全量重放 → 本文件。
--       （0034_lifetime_quota_pin 为纯数据回填，无行为断言）
-- 运行：psql -v ON_ERROR_STOP=1 -f scripts/verify-sync-local/scenario-0032-0034.sql
-- 断言风格：预期报错用 DO 块捕获并比对 SQLERRM（不符才 raise），
--           未预期的错误由 ON_ERROR_STOP 直接终止（退出码非 0 = 失败）。
\set ON_ERROR_STOP on

\echo '--- [0] 注册两个用户（触发器自动建 profile，quota 默认 5MB，0032） ---'
insert into auth.users (id, email)
values ('21111111-1111-1111-1111-111111111111', 'a@test'),
       ('21111111-1111-1111-1111-111111111112', 'b@test');

set role authenticated;
select set_config('request.jwt.claim.sub', '21111111-1111-1111-1111-111111111111', false);

\echo '--- [1] 新用户 profile：plan=free / 5MB ---'
select (public.bsync_get_profile())->>'plan'        as plan,        -- 期望 free
       (public.bsync_get_profile())->>'quota_bytes' as quota_bytes; -- 期望 5242880

\echo '--- [2] 建默认空间，登记 3 台设备（free 计划上限 3） ---'
select (public.bsync_space_create('默认空间')->>'id')::uuid as sid \gset
select set_config('bsync.test.space', :'sid', false);
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111101'::uuid, 'dev1');
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111102'::uuid, 'dev2');
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111103'::uuid, 'dev3');
select count(*) as devices from public.bsync_devices; -- 期望 3

\echo '--- [3] 第 4 台设备 → device_limit_reached（0033） ---'
DO $$
BEGIN
  PERFORM public.bsync_device_touch(current_setting('bsync.test.space')::uuid,
                                    '31111111-1111-1111-1111-111111111104'::uuid, 'dev4');
  RAISE EXCEPTION 'UNEXPECTED: 第 4 台设备登记未被拒绝';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%device_limit_reached%' THEN
    RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
  END IF;
  RAISE NOTICE 'OK: device_limit_reached';
END $$;

\echo '--- [4] 心跳不受限：已登记设备再次 touch 仍成功 ---'
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111101'::uuid, 'dev1');

\echo '--- [5] 自助移除一台后可再登记（bsync_device_remove 腾位） ---'
select public.bsync_device_remove('31111111-1111-1111-1111-111111111101'::uuid);
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111104'::uuid, 'dev4');
select count(*) as devices from public.bsync_devices; -- 期望 3

\echo '--- [6] 限流：restore 第 13 次（>12/分）→ rate_limited（0032） ---'
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..12 LOOP
    PERFORM public.bsync_rate_limit('restore');
  END LOOP;
  BEGIN
    PERFORM public.bsync_rate_limit('restore');
    RAISE EXCEPTION 'UNEXPECTED: restore 第 13 次未被限流';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%rate_limited%' THEN
      RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
    END IF;
    RAISE NOTICE 'OK: rate_limited';
  END;
END $$;

\echo '--- [7] 字节配额：>5MB 的单个 op → quota_exceeded（0032，free 有效配额 5MB） ---'
DO $$
BEGIN
  PERFORM public.bsync_op_push(
    current_setting('bsync.test.space')::uuid,
    '31111111-1111-1111-1111-111111111104'::uuid,
    jsonb_build_array(jsonb_build_object(
      'seq', 1,
      'op', jsonb_build_object('t', jsonb_build_object('counter', 1, 'replica', 'r'),
                               'p', 'root', 'c', 'child1',
                               'm', jsonb_build_object('pad', repeat('x', 6 * 1024 * 1024))),
      'cid', null)));
  RAISE EXCEPTION 'UNEXPECTED: 超 5MB 的 push 未被拒绝';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%quota_exceeded%' THEN
    RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
  END IF;
  RAISE NOTICE 'OK: quota_exceeded';
END $$;

\echo '--- [8] 配额内写入成功且 used_bytes 回写（0032 实时聚合口径） ---'
select public.bsync_op_push(
  current_setting('bsync.test.space')::uuid,
  '31111111-1111-1111-1111-111111111104'::uuid,
  jsonb_build_array(jsonb_build_object(
    'seq', 2,
    'op', jsonb_build_object('t', jsonb_build_object('counter', 2, 'replica', 'r'),
                             'p', 'root', 'c', 'child2',
                             'm', jsonb_build_object('pad', repeat('x', 10))),
    'cid', null)));
select used_bytes > 0 as used_refreshed  -- 期望 true
  from public.bsync_profiles
 where user_id = '21111111-1111-1111-1111-111111111111';

\echo '--- [9] plus 升级（模拟 webhook 写入）后设备上限放宽到 6 ---'
reset role;
update public.bsync_profiles
   set plan = 'plus', quota_bytes = 52428800
 where user_id = '21111111-1111-1111-1111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub', '21111111-1111-1111-1111-111111111111', false);
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111105'::uuid, 'dev5');
select public.bsync_device_touch(current_setting('bsync.test.space')::uuid, '31111111-1111-1111-1111-111111111106'::uuid, 'dev6');
DO $$
BEGIN
  PERFORM public.bsync_device_touch(current_setting('bsync.test.space')::uuid,
                                    '31111111-1111-1111-1111-111111111107'::uuid, 'dev7');
  RAISE EXCEPTION 'UNEXPECTED: plus 第 7 台设备登记未被拒绝';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%device_limit_reached%' THEN
    RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
  END IF;
  RAISE NOTICE 'OK: plus 上限 6 生效';
END $$;

\echo '--- [10] 收权负例（role-play，TENANTS #10）：authenticated 不可直改自己 plan / 直插 op_log（0032 §11） ---'
DO $$
BEGIN
  UPDATE public.bsync_profiles SET plan = 'pro', quota_bytes = 524288000
   WHERE user_id = auth.uid();
  RAISE EXCEPTION 'UNEXPECTED: authenticated 可直改 plan（自提权口子未关）';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 直改 plan 被拒绝';
  WHEN OTHERS THEN RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
END $$;

DO $$
BEGIN
  INSERT INTO public.bsync_op_log (space_id, device_id, seq, op)
  VALUES (current_setting('bsync.test.space')::uuid,
          '31111111-1111-1111-1111-111111111106'::uuid, 9999, '{}'::jsonb);
  RAISE EXCEPTION 'UNEXPECTED: authenticated 可直插 op_log（绕过配额口子未关）';
EXCEPTION
  WHEN insufficient_privilege THEN RAISE NOTICE 'OK: 直插 op_log 被拒绝';
  WHEN OTHERS THEN RAISE EXCEPTION 'UNEXPECTED: %', SQLERRM;
END $$;

\echo '--- [11] 跨用户隔离不变：B 用户摸不到 A 的空间/op（RLS 回归） ---'
select set_config('request.jwt.claim.sub', '21111111-1111-1111-1111-111111111112', false);
select count(*) as a_spaces_visible_to_b from public.bsync_spaces
 where owner_id = '21111111-1111-1111-1111-111111111111'; -- 期望 0
select count(*) as a_ops_visible_to_b from public.bsync_op_log o
  join public.bsync_spaces s on s.id = o.space_id
 where s.owner_id = '21111111-1111-1111-1111-111111111111'; -- 期望 0

\echo '=== 全部通过 ==='
