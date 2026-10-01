-- ============================================================================
-- 0045 feedback.sql — 插件内用户反馈通道（主动提交）+ 错误上报后台读取
-- 日期：2026-10-01
--
-- 背景：上架后唯一的故障信息来源是「用户投诉」。0042 已经落地了**自动**的错误
--   元数据上报，但存在两个缺口：
--     ① 用户想主动说「这里不好用 / 希望加个功能」时，插件内**没有任何入口**
--        （帮助页只有 7 条 FAQ，官网 /support 用户不会主动去）；
--     ② bsync_error_reports（0042）**只写不读** —— 没有 admin RPC、没有后台视图，
--        采集到的诊断数据实际上进了黑洞。
--   本迁移一次补齐：新增 bsync_feedback 表 + 提交 RPC，并给 0042 的表补后台读取
--   RPC（后台 /admin/feedback 同页两个 tab 消费）。
--
-- 与 0042 的**语义差异**（改本文件前先读）：
--   0042 的错误上报是**旁路** —— 超限 / 未登录一律静默 return(void)，绝不变成
--   新的失败面。0045 的反馈是**用户主动行为** —— 失败必须让用户看见，否则用户
--   以为发出去了。故 bsync_submit_feedback 返回 jsonb 让前端区分状态，而不是 void。
--
-- 隐私边界（硬约束）：
--   · 写入**只发生在前端已登录时**（RPC 内 auth.uid() 为空直接返回 unauthenticated）；
--   · 自动附带的环境列是**白名单**：app_version / platform / locale /
--     last_error_phase，全部为枚举型标量，**绝不含书签内容、网址、文件夹名、
--     口令或任何 E2EE 明文**；
--   · body / contact_email 是用户**自行输入**的自由文本，无法自动过滤 —— 已在
--     插件 UI 提示（feedback_privacyHint：请勿粘贴书签/网址）并在隐私政策披露。
--     这与 0042 对 error_message 的「接受的风险」口径一致。
--
-- 为什么写入走 SECURITY DEFINER RPC（而不是给 authenticated 表级 INSERT）：
--   对齐 0032/0040 的收权基线 —— 客户端角色对 bsync_* 表一律不给写权限，写入只
--   经 RPC，由 RPC 内部做身份绑定（user_id := auth.uid()）、长度截断与限流。这样
--   Data API 上**没有任何路径**可以伪造他人 user_id 或写超长载荷。
--   （反面教材：0041 收掉的 bsync_waitlist 表级 select 就是策略/授权未成对管理的后果。）
--
-- 限流口径（写清楚，别误读）：
--   · 限流对象是**每一行新增**（feedback 无指纹去重，每次提交都落行）；
--   · 两道闸门：每用户 10 分钟内最多 3 行、最近 24 小时最多 20 行；
--   · 与 0042（1 分钟 20 行 / 24 小时 200 行，针对错误风暴）相比收紧约一个数量级
--     —— 反馈是低频高价值的人工输入，不需要宽阈值；
--   · 超限**返回 {ok:false,error:'rate_limited'}**（不抛错），让 UI 能提示用户。
--
-- 授权（TENANTS.md 规范 11 —— 建表必须同迁移写全 grant）：
--   anon / authenticated → 表：无；序列：无（identity 列，插入不检查序列权限）。
--   authenticated        → 仅 EXECUTE bsync_submit_feedback / admin_*。
--   service_role         → 表 select/insert/update/delete + 序列 usage/select。
--   函数 EXECUTE 必须显式 revoke from PUBLIC —— PG 建函数默认给 PUBLIC 授权。
--
-- 幂等性：CREATE IF NOT EXISTS / OR REPLACE / 幂等 revoke+grant，可安全重放。
-- 自检 SQL：见文件末注释块（含规范 10 要求的 role-play 反例）。
-- ============================================================================

-- ---------- 1) 表 ----------
create table if not exists public.bsync_feedback (
    id                bigint      generated always as identity primary key,
    user_id           uuid        not null references auth.users (id) on delete cascade,

    -- 用户填写
    kind              text        not null default 'other'
                      constraint bsync_feedback_kind_chk
                      check (kind in ('bug', 'idea', 'other')),
    body              text        not null
                      constraint bsync_feedback_body_chk
                      check (char_length(body) between 1 and 2000),
    contact_email     text
                      constraint bsync_feedback_email_chk
                      check (contact_email is null or char_length(contact_email) <= 200),

    -- 后台处理
    status            text        not null default 'new'
                      constraint bsync_feedback_status_chk
                      check (status in ('new', 'read', 'resolved', 'wontfix')),
    admin_note        text        not null default '',
    status_changed_at timestamptz,

    -- 自动附带的环境元数据（隐私白名单，见文件头）
    app_version       text,
    platform          text,
    locale            text,
    last_error_phase  text,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

comment on table public.bsync_feedback is
'用户主动提交的反馈（问题/建议/其他）+ 可选回信邮箱 + 自动附带的环境元数据。写入仅经 bsync_submit_feedback RPC（0045），状态由 admin_set_feedback_status 标记。隐私边界：环境列只含版本/浏览器/语言/错误阶段，绝不含书签内容、网址、文件夹名、口令或任何 E2EE 明文；body 为用户自行输入，UI 已提示勿粘贴敏感信息。';
comment on column public.bsync_feedback.kind is
'反馈类型：bug=问题反馈 / idea=功能建议 / other=其他（RPC 白名单归一，非法值降级 other）';
comment on column public.bsync_feedback.status is
'处理状态：new=待处理 / read=已读 / resolved=已处理 / wontfix=不处理';
comment on column public.bsync_feedback.contact_email is
'可选回信邮箱（仅长度校验，格式由 RPC 正则把关）；NULL = 用户未填、无法回复';
comment on column public.bsync_feedback.last_error_phase is
'最近一次错误上报的阶段码（枚举型，来自 src/lib/telemetry.ts），仅供排查上下文';

-- 索引：后台默认视图按时间倒序；按状态筛选；RPC 内两道限流 count 走 (user_id, created_at)
create index if not exists bsync_feedback_created_idx on public.bsync_feedback (created_at desc);
create index if not exists bsync_feedback_status_idx  on public.bsync_feedback (status, created_at desc);
create index if not exists bsync_feedback_user_idx    on public.bsync_feedback (user_id, created_at desc);

alter table public.bsync_feedback enable row level security;
-- 无 RLS 策略（默认全拒）：客户端只能经 SECURITY DEFINER RPC 写入（TENANTS #4）

-- ---------- 2) 授权（显式 + 最小；禁止靠平台默认权限） ----------
revoke all on public.bsync_feedback from anon, authenticated;
revoke all on sequence public.bsync_feedback_id_seq from anon, authenticated;
grant select, insert, update, delete on public.bsync_feedback to service_role;
grant usage, select on sequence public.bsync_feedback_id_seq to service_role;

-- ---------- 3) 提交 RPC（扩展端） ----------
create or replace function public.bsync_submit_feedback(
    p_kind             text,
    p_body             text,
    p_contact_email    text default null,
    p_app_version      text default null,
    p_platform         text default null,
    p_locale           text default null,
    p_last_error_phase text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_kind   text;
  v_body   text;
  v_email  text;
  v_recent int;
  v_daily  int;
  v_id     bigint;
begin
  -- 未登录：明确告知前端（与 0042 的静默不同 —— 反馈是用户主动行为）
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  -- 正文：去首尾空白后截断；空则拒绝
  v_body := left(btrim(coalesce(p_body, '')), 2000);
  if v_body = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  -- 类型：白名单归一，非法值降级 other（不因 UI bug 让用户失败）
  v_kind := lower(btrim(coalesce(p_kind, 'other')));
  if v_kind not in ('bug', 'idea', 'other') then
    v_kind := 'other';
  end if;

  -- 回信邮箱：可选；给了就校验格式
  v_email := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  if v_email is not null then
    v_email := left(v_email, 200);
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      return jsonb_build_object('ok', false, 'error', 'invalid_email');
    end if;
  end if;

  -- 限流（见文件头「限流口径」）：超限返回可识别错误，不抛错
  select count(*) into v_recent
    from public.bsync_feedback
   where user_id = v_user and created_at > now() - interval '10 minutes';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select count(*) into v_daily
    from public.bsync_feedback
   where user_id = v_user and created_at > now() - interval '1 day';
  if v_daily >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.bsync_feedback
    (user_id, kind, body, contact_email, app_version, platform, locale, last_error_phase)
  values
    (v_user, v_kind, v_body, v_email,
     left(coalesce(p_app_version, ''), 40),
     left(coalesce(p_platform, ''), 40),
     left(coalesce(p_locale, ''), 16),
     left(coalesce(p_last_error_phase, ''), 40))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.bsync_submit_feedback(text, text, text, text, text, text, text) is
'客户端提交反馈（0045）：SECURITY DEFINER，user_id 取 auth.uid() 不可伪造；未登录/空正文/邮箱非法/超限均返回 {ok:false,error:...} 而非抛错（反馈是用户主动行为，失败必须可见）。';

-- ---------- 4) 后台读取 RPC（官网 /admin/feedback 消费） ----------

-- 4.1 反馈列表：按状态 / 类型过滤 + 分页
create or replace function public.admin_list_feedback(
  p_status text default null,   -- new / read / resolved / wontfix；null = 全部
  p_kind   text default null,   -- bug / idea / other；null = 全部
  p_limit  int  default 50,
  p_offset int  default 0
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
    from public.bsync_feedback f
   where (p_status is null or f.status = p_status)
     and (p_kind   is null or f.kind   = p_kind);

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
    from (
      select f.id, f.user_id, u.email, f.kind, f.body, f.contact_email,
             f.status, f.admin_note, f.app_version, f.platform, f.locale,
             f.last_error_phase, f.created_at, f.updated_at, f.status_changed_at
        from public.bsync_feedback f
        left join auth.users u on u.id = f.user_id
       where (p_status is null or f.status = p_status)
         and (p_kind   is null or f.kind   = p_kind)
       order by f.created_at desc, f.id desc
       limit p_limit offset p_offset
    ) t;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;
comment on function public.admin_list_feedback(text, text, int, int) is
'后台反馈列表：按状态/类型过滤 + 分页，join auth.users 带出提交者邮箱；只读，不写审计；body 为用户自由文本（上限 2000 字），后台表格需截断展示。';

-- 4.2 标记反馈状态（写操作 → 必须写审计）
create or replace function public.admin_set_feedback_status(
  p_id     bigint,
  p_status text,
  p_note   text default ''
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old    text;
  v_target uuid;
  v_note   text;
begin
  perform public.assert_bsync_admin();

  if p_status not in ('new', 'read', 'resolved', 'wontfix') then
    raise exception 'invalid status: %', p_status;
  end if;

  select status, user_id into v_old, v_target
    from public.bsync_feedback
   where id = p_id;
  if not found then
    raise exception 'feedback not found: %', p_id;
  end if;

  v_note := left(coalesce(p_note, ''), 500);

  update public.bsync_feedback
     set status            = p_status,
         admin_note        = v_note,
         status_changed_at = now(),
         updated_at        = now()
   where id = p_id;

  insert into public.bsync_admin_audit_log (admin_id, action, target_user, detail)
  values (auth.uid(), 'mark_feedback', v_target,
          jsonb_build_object('feedback_id', p_id, 'old', v_old, 'new', p_status, 'note', v_note));

  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end;
$$;
comment on function public.admin_set_feedback_status(bigint, text, text) is
'后台标记反馈状态（new/read/resolved/wontfix）+ 可选备注；写操作，内联写入 bsync_admin_audit_log（action=mark_feedback，detail 含改前/改后）。';

-- 4.3 错误上报列表（读 0042 的表，补上缺失的读取通道）
--     该表已 revoke anon/authenticated、service_role 有全量 DML，
--     SECURITY DEFINER 即可读取，无需补表级 grant。
create or replace function public.admin_list_error_reports(
  p_phase       text default null,          -- 按 phase 过滤
  p_app_version text default null,          -- 按版本过滤
  p_group       text default 'row',         -- 'row' = 逐行；'fingerprint' = 按指纹聚合
  p_limit       int  default 50,
  p_offset      int  default 0
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
  if p_group not in ('row', 'fingerprint') then
    p_group := 'row';
  end if;

  if p_group = 'fingerprint' then
    -- 聚合视图：回答「哪个错误最广谱」（影响用户数 + 总次数）
    select count(*) into v_total
      from (select 1 from public.bsync_error_reports r
             where (p_phase is null or r.phase = p_phase)
               and (p_app_version is null or r.app_version = p_app_version)
             group by r.fingerprint) g;

    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
      from (
        select r.fingerprint,
               sum(r.occurrences)                        as occurrences,
               count(distinct r.user_id)                 as user_count,
               min(r.phase)                              as phase,
               min(r.reason)                             as reason,
               min(r.error_name)                         as error_name,
               left(min(r.error_message), 200)           as error_message,
               max(r.app_version)                        as app_version,
               min(r.first_seen_at)                      as first_seen_at,
               max(r.last_seen_at)                       as last_seen_at
          from public.bsync_error_reports r
         where (p_phase is null or r.phase = p_phase)
           and (p_app_version is null or r.app_version = p_app_version)
         group by r.fingerprint
         order by sum(r.occurrences) desc, max(r.last_seen_at) desc
         limit p_limit offset p_offset
      ) t;
  else
    -- 逐行视图：排查单个用户的具体错误
    select count(*) into v_total
      from public.bsync_error_reports r
     where (p_phase is null or r.phase = p_phase)
       and (p_app_version is null or r.app_version = p_app_version);

    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_rows
      from (
        select r.id, r.user_id, u.email, r.fingerprint, r.phase, r.reason,
               r.error_name, left(r.error_message, 200) as error_message,
               r.app_version, r.platform, r.occurrences,
               r.first_seen_at, r.last_seen_at
          from public.bsync_error_reports r
          left join auth.users u on u.id = r.user_id
         where (p_phase is null or r.phase = p_phase)
           and (p_app_version is null or r.app_version = p_app_version)
         order by r.last_seen_at desc, r.id desc
         limit p_limit offset p_offset
      ) t;
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;
comment on function public.admin_list_error_reports(text, text, text, int, int) is
'后台错误上报列表（读 0042 的 bsync_error_reports）：p_group=row 逐行（排查单用户）/ fingerprint 按指纹聚合（看影响面）；error_message 截 200 字，完整 stack 走 admin_get_error_report。只读。';

-- 4.4 错误上报详情：完整 stack + context（列表不返回，避免翻页 payload 膨胀）
create or replace function public.admin_get_error_report(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
begin
  perform public.assert_bsync_admin();

  select row_to_json(t)::jsonb into v_row
    from (
      select r.id, r.user_id, u.email, r.fingerprint, r.phase, r.reason,
             r.error_name, r.error_message, r.error_stack, r.context,
             r.app_version, r.platform, r.occurrences,
             r.first_seen_at, r.last_seen_at
        from public.bsync_error_reports r
        left join auth.users u on u.id = r.user_id
       where r.id = p_id
    ) t;

  if v_row is null then
    raise exception 'error report not found: %', p_id;
  end if;

  return v_row;
end;
$$;
comment on function public.admin_get_error_report(bigint) is
'后台错误上报详情：返回完整 error_stack（上限 2000 字）与 context jsonb，供弹窗查看；列表 RPC 只给截断后的 message，避免 payload 膨胀。只读。';

-- ---------- 5) 函数 EXECUTE 授权 ----------
-- PG 建函数默认授 EXECUTE 给 PUBLIC → 必须显式收回，再只授需要的角色
revoke all on function public.bsync_submit_feedback(text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bsync_submit_feedback(text, text, text, text, text, text, text)
  to authenticated;

revoke all on function public.admin_list_feedback(text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_feedback(text, text, int, int) to authenticated;

revoke all on function public.admin_set_feedback_status(bigint, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_feedback_status(bigint, text, text) to authenticated;

revoke all on function public.admin_list_error_reports(text, text, text, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_error_reports(text, text, text, int, int) to authenticated;

revoke all on function public.admin_get_error_report(bigint) from public, anon, authenticated;
grant execute on function public.admin_get_error_report(bigint) to authenticated;

-- ============================================================================
-- 自检 SQL（执行后复核；也可与迁移一起放进 begin ... rollback 做零改动预演）
--
--   -- ① 表级权限：anon/authenticated 应为 0 项
--   select r.rolname, a.privilege_type
--     from pg_class c
--     cross join lateral aclexplode(c.relacl) a
--     join pg_roles r on r.oid = a.grantee
--    where c.relname = 'bsync_feedback' and r.rolname in ('anon','authenticated');
--   -- 期望：0 行
--
--   -- ② RLS 已开且无策略
--   select relrowsecurity, (select count(*) from pg_policies
--     where schemaname='public' and tablename='bsync_feedback') as policies
--     from pg_class where relname='bsync_feedback' and relnamespace='public'::regnamespace;
--   -- 期望：t | 0
--
--   -- ③ 函数 EXECUTE：authenticated 有，anon/PUBLIC 无（逐个函数复核）
--   select r.rolname,
--          has_function_privilege(r.oid, 'public.bsync_submit_feedback(text,text,text,text,text,text,text)', 'EXECUTE') as submit,
--          has_function_privilege(r.oid, 'public.admin_list_feedback(text,text,int,int)', 'EXECUTE') as list_fb,
--          has_function_privilege(r.oid, 'public.admin_set_feedback_status(bigint,text,text)', 'EXECUTE') as mark_fb,
--          has_function_privilege(r.oid, 'public.admin_list_error_reports(text,text,text,int,int)', 'EXECUTE') as list_er,
--          has_function_privilege(r.oid, 'public.admin_get_error_report(bigint)', 'EXECUTE') as get_er
--     from pg_roles r where r.rolname in ('anon','authenticated','service_role','public');
--   -- 期望：anon 全 f；authenticated 全 t；service_role 全 f；public 全 f
--
--   -- ④ role-play（TENANTS #10）：authenticated 不能直插表（必须 42501）
--   begin;
--     set local role authenticated;
--     insert into public.bsync_feedback (user_id, body)
--       values (auth.uid(), 'x');   -- 期望 42501
--   rollback;
--
--   -- ⑤ role-play：未登录调提交 RPC 返回 unauthenticated（非抛错）
--   --    用 postgres 直接调（auth.uid() 为 null）：
--   select public.bsync_submit_feedback('bug', 'hello');
--   -- 期望：{"ok": false, "error": "unauthenticated"}
--
--   -- ⑥ role-play：限流（需以 authenticated 身份伪造 JWT，见
--   --    scripts/verify-sync-local/scenario-0045-feedback.sql）
-- ============================================================================
