-- ============================================================================
-- 0026 admin_audit_view.sql — 后台审计日志查看 RPC
-- 日期：2026-09-18
-- 背景：0020 起所有后台写操作（set_plan / reset_usage / reset_user_data /
--       set_gc_threshold / request_gc）都会写入 bsync_admin_audit_log，但后台
--       只有写入、没有读取界面。本迁移补上只读查询：admin_list_audit_log，
--       前端 /admin/audit 页面消费（谁、何时、做了什么、改了谁、改前/改后值）。
--
-- 安全模型（与 0020 一致）：
--   1. SECURITY DEFINER，函数体第一行 assert_bsync_admin()，非管理员抛 forbidden。
--   2. 只读 bsync_admin_audit_log 元数据；该表本身已 revoke anon, authenticated，
--      只能通过本 RPC 间接访问。
--   3. detail 仅含 plan / 配额 / 计数等运营字段，不涉及书签密文。
--
-- 幂等性：OR REPLACE，可安全重放。
-- 范围：仅新增 admin_* 对象；不修改已有表、不改已有 RLS 策略。
-- ============================================================================

create or replace function public.admin_list_audit_log(
  p_action text   default null,   -- 按 action 过滤（set_plan / reset_usage / ...），null = 全部
  p_target uuid   default null,   -- 按目标用户过滤，null = 全部
  p_limit  int    default 50,
  p_offset int    default 0
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total bigint;
  v_rows  jsonb;
begin
  perform public.assert_bsync_admin();
  if p_limit is null or p_limit <= 0 then
    p_limit := 50;
  end if;
  if p_limit > 500 then
    p_limit := 500;
  end if;
  if p_offset is null or p_offset < 0 then
    p_offset := 0;
  end if;

  select count(*) into v_total
    from public.bsync_admin_audit_log a
   where (p_action is null or a.action = p_action)
     and (p_target is null or a.target_user = p_target);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
    from (
      select a.id, a.action, a.target_user,
             u.email  as admin_email,
             tu.email as target_email,
             a.detail, a.created_at
        from public.bsync_admin_audit_log a
        left join auth.users u  on u.id  = a.admin_id
        left join auth.users tu on tu.id = a.target_user
       where (p_action is null or a.action = p_action)
         and (p_target is null or a.target_user = p_target)
       order by a.id desc
       limit p_limit offset p_offset
    ) t;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;
comment on function public.admin_list_audit_log(text, uuid, int, int) is
'后台审计日志：按 action / 目标用户过滤 + 分页；返回管理员邮箱与目标用户邮箱（join auth.users），detail 含改前/改后值；只读，不涉及书签密文';

-- ---------- 授权 ----------
revoke all on function public.admin_list_audit_log(text, uuid, int, int) from anon;
grant execute on function public.admin_list_audit_log(text, uuid, int, int) to authenticated;
