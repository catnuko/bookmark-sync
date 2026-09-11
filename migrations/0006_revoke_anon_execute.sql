-- 权限收紧：Supabase 对 public schema 新建函数默认授予 anon EXECUTE，
-- `revoke ... from public` 撤不掉这些显式授权。此处显式从 anon 收回。
-- 三个函数本身已用 auth.uid() 自守（anon 调用必抛 not authenticated），
-- 此迁移只是让"最小权限"在 ACL 上真正成立。

revoke execute on function public.bsync_snapshot_push(jsonb, jsonb, text) from anon;
revoke execute on function public.bsync_snapshot_pull() from anon;
revoke execute on function public.bsync_touch_used(uuid, bigint) from anon;
