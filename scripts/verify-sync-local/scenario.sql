-- ============ 同步协议本地验证（真实 Postgres + 完整迁移） ============
-- 新格式：节点带 sync_id / parent_sync_id / type / url / title / order
-- 场景：三端初始 {C1, C2(folder), A} → A 删除 A → B 新增 N → C 同步 → 期望收敛
--       随后验证：非删除设备重加被墓碑过滤；原删除设备重加复活。
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

\echo '--- [1] 设备A 首次推送：文件夹F + 书签 C1,A（挂在根） ---'
select public.bsync_snapshot_push(
  '[{"sync_id":"sy-folderF","parent_sync_id":"__bar__","type":"folder","title":"F","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-c1","parent_sync_id":"__bar__","type":"bookmark","url":"https://c1.example.com","title":"C1","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-a","parent_sync_id":"sy-folderF","type":"bookmark","url":"https://a.example.com","title":"A","order":0,"updated_at":"2026-01-01T00:00:00Z"}]'::jsonb,
  '[]'::jsonb, 'devA');

\echo '--- [2] 设备A 删除 A(sy-a) → 推送剩余 + 墓碑[sy-a] ---'
select public.bsync_snapshot_push(
  '[{"sync_id":"sy-folderF","parent_sync_id":"__bar__","type":"folder","title":"F","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-c1","parent_sync_id":"__bar__","type":"bookmark","url":"https://c1.example.com","title":"C1","order":0,"updated_at":"2026-01-01T00:00:00Z"}]'::jsonb,
  '[{"sync_id":"sy-a","url":"https://a.example.com"}]'::jsonb, 'devA');

\echo '--- [2-check] 服务端状态（期望 bookmarks 含 F,C1；tombstone 含 sy-a） ---'
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [3] 设备B 新增 N → 推送 {F,C1,N}（并集保留） ---'
select public.bsync_snapshot_push(
  '[{"sync_id":"sy-folderF","parent_sync_id":"__bar__","type":"folder","title":"F","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-c1","parent_sync_id":"__bar__","type":"bookmark","url":"https://c1.example.com","title":"C1","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-n","parent_sync_id":"__bar__","type":"bookmark","url":"https://n.example.com","title":"N","order":1,"updated_at":"2026-01-02T00:00:00Z"}]'::jsonb,
  '[]'::jsonb, 'devB');

\echo '--- [4] 设备C 拉取（期望 bookmarks={F,C1,N} tombstone={sy-a}） ---'
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [5] 非删除设备C 重新添加 A(sy-a) → 应被墓碑过滤（粘性删除，不复活） ---'
select public.bsync_snapshot_push(
  '[{"sync_id":"sy-folderF","parent_sync_id":"__bar__","type":"folder","title":"F","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-c1","parent_sync_id":"__bar__","type":"bookmark","url":"https://c1.example.com","title":"C1","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-n","parent_sync_id":"__bar__","type":"bookmark","url":"https://n.example.com","title":"N","order":1,"updated_at":"2026-01-02T00:00:00Z"},
    {"sync_id":"sy-a","parent_sync_id":"sy-folderF","type":"bookmark","url":"https://a.example.com","title":"A","order":0,"updated_at":"2026-01-03T00:00:00Z"}]'::jsonb,
  '[]'::jsonb, 'devC');
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [6] 原删除设备A 重新添加 A(sy-a) → 重加获胜（A 回到快照、墓碑清除） ---'
select public.bsync_snapshot_push(
  '[{"sync_id":"sy-folderF","parent_sync_id":"__bar__","type":"folder","title":"F","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-c1","parent_sync_id":"__bar__","type":"bookmark","url":"https://c1.example.com","title":"C1","order":0,"updated_at":"2026-01-01T00:00:00Z"},
    {"sync_id":"sy-n","parent_sync_id":"__bar__","type":"bookmark","url":"https://n.example.com","title":"N","order":1,"updated_at":"2026-01-02T00:00:00Z"},
    {"sync_id":"sy-a","parent_sync_id":"sy-folderF","type":"bookmark","url":"https://a.example.com","title":"A","order":0,"updated_at":"2026-01-04T00:00:00Z"}]'::jsonb,
  '[]'::jsonb, 'devA');
select (public.bsync_snapshot_pull())->>'bookmarks'  as bookmarks,
       (public.bsync_snapshot_pull())->>'tombstones' as tombstones;

\echo '--- [7] 配额：墓碑过滤后快照大小与 used_bytes 一致 ---'
select plan, used_bytes, quota_bytes from public.bsync_profiles
where user_id = '11111111-1111-1111-1111-111111111111';

\echo '--- [8] 未登录调用应报错 ---'
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.bsync_snapshot_pull();