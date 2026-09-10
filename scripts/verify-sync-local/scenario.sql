-- ============ 同步协议本地验证（真实 Postgres + 完整迁移） ============
-- 场景：三端初始 {C1, C2, A} → A 删除 A → B 新增 N → C 同步 → 期望收敛 {C1, C2, N}
\set ON_ERROR_STOP on

-- 0. 模拟用户注册（0003 的 trigger 应自动建 profile）
insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'tester@test');

\echo '--- [0] 注册后自动建 profile ---'
select plan, quota_bytes, used_bytes
from public.bsync_profiles
where user_id = '11111111-1111-1111-1111-111111111111';

-- 以 authenticated 角色运行，模拟真实 API 调用（含 RLS）
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

\echo '--- [1] 设备A 首次推送初始 {C1,C2,A} ---'
select public.bsync_snapshot_push(
  '[{"url":"https://c1.example.com","title":"C1","folder":"BAR"},
    {"url":"https://c2.example.com","title":"C2","folder":"BAR"},
    {"url":"https://a.example.com","title":"A","folder":"BAR"}]'::jsonb,
  '[]'::jsonb, 'devA');

\echo '--- [2] 设备A 删除A → 推送 {C1,C2} + 墓碑[A] ---'
select public.bsync_snapshot_push(
  '[{"url":"https://c1.example.com","title":"C1","folder":"BAR"},
    {"url":"https://c2.example.com","title":"C2","folder":"BAR"}]'::jsonb,
  '["https://a.example.com"]'::jsonb, 'devA');

\echo '--- [2-check] 服务端状态（期望 bookmarks={C1,C2} tombstone={A}） ---'
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [3] 设备B（本地已有A）新增N → 同步后推送 {C1,C2,N} ---'
select public.bsync_snapshot_push(
  '[{"url":"https://c1.example.com","title":"C1","folder":"BAR"},
    {"url":"https://c2.example.com","title":"C2","folder":"BAR"},
    {"url":"https://n.example.com","title":"N","folder":"BAR"}]'::jsonb,
  '[]'::jsonb, 'devB');

\echo '--- [4] 设备C 拉取（期望 bookmarks={C1,C2,N} tombstone={A}） ---'
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [5] 原删除设备A 重新添加A → 重加获胜（A 回到快照、墓碑清除） ---'
select public.bsync_snapshot_push(
  '[{"url":"https://c1.example.com","title":"C1","folder":"BAR"},
    {"url":"https://c2.example.com","title":"C2","folder":"BAR"},
    {"url":"https://n.example.com","title":"N","folder":"BAR"},
    {"url":"https://a.example.com","title":"A","folder":"BAR"}]'::jsonb,
  '[]'::jsonb, 'devA');
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [6] 非删除设备C 重新添加A → 应被墓碑过滤（粘性删除） ---'
select public.bsync_snapshot_push(
  '[{"url":"https://c1.example.com","title":"C1","folder":"BAR"},
    {"url":"https://c2.example.com","title":"C2","folder":"BAR"},
    {"url":"https://n.example.com","title":"N","folder":"BAR"},
    {"url":"https://a.example.com","title":"A","folder":"BAR"}]'::jsonb,
  '[]'::jsonb, 'devC');
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [7] 配额：墓碑过滤后快照大小与 used_bytes 一致 ---'
select plan, used_bytes, quota_bytes from public.bsync_profiles
where user_id = '11111111-1111-1111-1111-111111111111';

\echo '--- [8] 未登录调用应报错 ---'
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.bsync_snapshot_pull();
