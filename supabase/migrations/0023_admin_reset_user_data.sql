-- ============================================================================
-- 0023 admin_reset_user_data.sql — 后台一键清空用户测试数据
-- 日期：2026-09-17
-- 背景：插件「高级 → 测试工具 → 一键清空测试数据」从扩展端移除，
--       改为后台管理系统（website/src/admin）操作：管理员选定用户后清空其
--       云端全部同步数据（快照 / 操作日志 / 设备 / 空间）并重置 profile 盐与用量。
--       本文件只新增 admin_* 对象，不修改已有表、不改 RLS 策略（与 0020 约定一致）。
--
-- 安全模型（与 0020 一致）：
--   1. SECURITY DEFINER，函数体第一行 assert_bsync_admin()，非管理员抛 forbidden。
--   2. 只删目标用户 owner_id 的数据，按外键顺序（snapshots → op_log → devices → spaces）。
--   3. 不 select / 不返回任何书签密文（bsync_op_log.op / bsync_snapshots.data）。
--   4. 写审计日志（谁在何时清了谁的多少数据）。
-- ============================================================================

create or replace function public.admin_reset_user_data(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email  text;
  v_spaces bigint := 0;
  v_ops    bigint := 0;
  v_snaps  bigint := 0;
  v_devs   bigint := 0;
begin
  perform public.assert_bsync_admin();
  if p_user is null then
    raise exception 'user id required';
  end if;

  select email into v_email from auth.users where id = p_user;
  if v_email is null then
    raise exception 'user not found';
  end if;

  -- 统计（仅元数据计数，不读取密文）
  select count(*) into v_snaps
    from public.bsync_snapshots s
    join public.bsync_spaces sp on sp.id = s.space_id
   where sp.owner_id = p_user;

  select count(*) into v_ops
    from public.bsync_op_log o
    join public.bsync_spaces sp on sp.id = o.space_id
   where sp.owner_id = p_user;

  select count(*) into v_devs
    from public.bsync_devices d
    join public.bsync_spaces sp on sp.id = d.space_id
   where sp.owner_id = p_user;

  select count(*) into v_spaces
    from public.bsync_spaces where owner_id = p_user;

  -- 按外键顺序删除（先子表后父表）
  delete from public.bsync_snapshots s
   using public.bsync_spaces sp
   where s.space_id = sp.id and sp.owner_id = p_user;

  delete from public.bsync_op_log o
   using public.bsync_spaces sp
   where o.space_id = sp.id and sp.owner_id = p_user;

  delete from public.bsync_devices d
   using public.bsync_spaces sp
   where d.space_id = sp.id and sp.owner_id = p_user;

  delete from public.bsync_spaces where owner_id = p_user;

  -- 重置 profile（盐 / 用量清零，等价于插件旧 resetTestData 的服务端部分）
  update public.bsync_profiles
     set e2ee_salt = null, used_count = 0, used_bytes = 0
   where user_id = p_user;

  insert into public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  values (auth.uid(), 'reset_user_data', p_user,
          jsonb_build_object('email', v_email, 'spaces', v_spaces, 'op_log', v_ops,
                             'snapshots', v_snaps, 'devices', v_devs));

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
comment on function public.admin_reset_user_data(uuid) is
'后台一键清空某用户的云端同步数据（快照/操作日志/设备/空间）并重置 profile 盐与用量；不解密不返回书签密文；写审计日志';

-- ---------- 授权 ----------
revoke all on function public.admin_reset_user_data(uuid) from anon;
grant execute on function public.admin_reset_user_data(uuid) to authenticated;
