-- ============================================================================
-- 0056_delete_account.sql — 用户自助注销账户（插件「注销账户」按钮的服务端能力）
-- 日期：2026-11-23
-- 背景：用户邮件要求永久删除账户与全部关联数据；产品决定插件内置自助注销
--       入口（设置页 → 账户面板 → 危险操作区 → 二次确认弹窗 → 调本 RPC）。
--
-- 安全模型（与 0023 admin_reset_user_data 一致）：
--   1. SECURITY DEFINER；函数体先校验 auth.uid() 非空。
--   2. 无参数——只删 auth.uid() 自己，调用方无法指定他人（无 IDOR 面）。
--   3. 统计与审计在删 auth.users 之前完成（行级联删除后查不到 email 与计数）。
--   4. 审计口径复用 0023：bsync_admin_audit_log(admin_id, action='delete_account',
--      target_user, detail={email, spaces, op_log, snapshots, devices})。
--      detail 快照 email —— 用户行删除后 0026 视图 join 不回 auth.users，
--      审计页的邮箱全靠这份快照（与 0023 同理）。
--   5. 不 select / 不返回任何书签密文（与 0023 同一条纪律）。
-- 依赖：bsync_* 表外键均 references auth.users ... on delete cascade
--       （0001/0002/0003/0005/0012/0013/0014/0028/0042/0045 等；bsync_subscriptions
--       为 on delete set null），删 auth.users 行即级联清理全部云端同步数据。
-- ============================================================================

create or replace function public.bsync_delete_account()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid;
  v_email  text;
  v_spaces bigint := 0;
  v_ops    bigint := 0;
  v_snaps  bigint := 0;
  v_devs   bigint := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'user not found';
  end if;

  -- 统计（仅元数据计数，不读取密文）——与 admin_reset_user_data 同口径
  select count(*) into v_snaps
    from public.bsync_snapshots s
    join public.bsync_spaces sp on sp.id = s.space_id
   where sp.owner_id = v_uid;

  select count(*) into v_ops
    from public.bsync_op_log o
    join public.bsync_spaces sp on sp.id = o.space_id
   where sp.owner_id = v_uid;

  select count(*) into v_devs
    from public.bsync_devices d
    join public.bsync_spaces sp on sp.id = d.space_id
   where sp.owner_id = v_uid;

  select count(*) into v_spaces
    from public.bsync_spaces where owner_id = v_uid;

  -- 审计先行（删用户后 audit 行保留；admin_id=target_user=本人，即「谁在何时删了谁」）
  insert into public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  values (v_uid, 'delete_account', v_uid,
          jsonb_build_object('email', v_email, 'spaces', v_spaces, 'op_log', v_ops,
                             'snapshots', v_snaps, 'devices', v_devs));

  -- 删 auth.users 行：bsync_* 外键 on delete cascade，云端数据随之级联清理
  delete from auth.users where id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'spaces', v_spaces,
    'op_log', v_ops,
    'snapshots', v_snaps,
    'devices', v_devs
  );
end;
$$;
comment on function public.bsync_delete_account() is
'用户自助注销：删除当前登录用户 auth.users 行（bsync_* 外键级联清理全部云端数据），删前按 0023 口径写审计日志（action=delete_account，detail 快照 email 与各类计数）；不解密不返回书签密文';

-- ---------- 授权 ----------
revoke all on function public.bsync_delete_account() from anon;
grant execute on function public.bsync_delete_account() to authenticated;
