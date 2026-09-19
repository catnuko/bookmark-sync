-- 0010 数据字典注释：为全部表/列/函数添加中文描述
-- 用途：让后续开发者/agent 无需连库即可理解每个对象的用途。
-- 注意：所有 COMMENT 均幂等（可重复执行，重复执行只是覆盖注释）。

-- ============================================================
-- 1. 表注释
-- ============================================================

comment on table public.bsync_profiles is
  '浏览器书签同步-用户档案：付费档位与配额。与 auth.users 一一对应，新用户注册时由触发器自动创建。';
comment on table public.bsync_snapshots is
  '浏览器书签同步-快照：每次全量同步产生一条 JSONB 快照，用于跨设备恢复历史版本。';
comment on table public.bsync_tombstones is
  '浏览器书签同步-墓碑：记录已删除书签的 url，防止删除后在多设备间复活。';

comment on table public.projects is
  'snaply 项目表：每个开发者可创建多个项目，项目下管理 License/Token/余额。owner_id 为创建者。';
comment on table public.project_members is
  '项目成员表：project 与 user 多对多关联，标识哪些用户可访问/操作该项目。';
comment on table public.profiles is
  '项目内用户余额档案：按 (id, project_id) 记录每个用户在每个项目下的 USD 余额。';
comment on table public.user_profiles is
  '用户全局订阅状态：跨项目的订阅计划（free/pro 等）与到期时间。';
comment on table public.licenses is
  'License 卡：开发者批量生成的授权码，可按次数(max_usage)与到期日(expire_date)发放使用权限。';
comment on table public.license_usage_logs is
  'License 使用日志：记录每次 License 校验请求的来源 IP、UA、结果，用于审计与防滥用。';
comment on table public.user_tokens is
  'API Token 卡：开发者生成的令牌，客户端携带 token 调用 consume_token 换取 plan 权限。';

-- ============================================================
-- 2. 列注释
-- ============================================================

-- bsync_profiles
comment on column public.bsync_profiles.user_id is '用户 ID（引用 auth.users.id）';
comment on column public.bsync_profiles.plan is '付费档位：free / pro / lifetime';
comment on column public.bsync_profiles.quota_bytes is '配额上限（字节），Free 默认 5MB';
comment on column public.bsync_profiles.used_bytes is '已用空间（字节）';
comment on column public.bsync_profiles.purchased_at is '付费时间（lifetime 档位）';

-- bsync_snapshots
comment on column public.bsync_snapshots.id is '快照 ID（自增）';
comment on column public.bsync_snapshots.user_id is '所属用户（引用 auth.users.id）';
comment on column public.bsync_snapshots.data is '快照内容（JSONB，书签全集）';
comment on column public.bsync_snapshots.created_at is '快照创建时间';

-- bsync_tombstones
comment on column public.bsync_tombstones.user_id is '用户 ID（引用 auth.users.id）';
comment on column public.bsync_tombstones.url is '被删除书签的 URL（主键之一）';
comment on column public.bsync_tombstones.device is '执行删除的设备标识';
comment on column public.bsync_tombstones.created_at is '删除时间';

-- projects
comment on column public.projects.id is '项目 ID（默认 uuid 随机生成）';
comment on column public.projects.slug is '项目唯一短标识（可为空）';
comment on column public.projects.name is '项目名称';
comment on column public.projects.owner_id is '项目创建者（引用 auth.users.id，可为空）';
comment on column public.projects.created_at is '创建时间';

-- project_members
comment on column public.project_members.project_id is '项目 ID（引用 projects.id）';
comment on column public.project_members.user_id is '成员用户 ID';
comment on column public.project_members.role is '成员角色，默认 member';

-- profiles
comment on column public.profiles.id is '用户 ID（引用 auth.users.id）';
comment on column public.profiles.created_at is '创建时间';
comment on column public.profiles.updated_at is '更新时间';
comment on column public.profiles.project_id is '项目 ID（引用 projects.id）';
comment on column public.profiles.balance_usd is '项目内 USD 余额，默认 2.0';

-- user_profiles
comment on column public.user_profiles.user_id is '用户 ID（引用 auth.users.id）';
comment on column public.user_profiles.plan is '订阅计划：free / pro 等';
comment on column public.user_profiles.subscription_status is '订阅状态：active / inactive 等';
comment on column public.user_profiles.expires_at is '订阅到期时间';
comment on column public.user_profiles.updated_at is '更新时间';

-- licenses
comment on column public.licenses.id is 'License ID（默认 uuid 随机生成）';
comment on column public.licenses.project_id is '所属项目 ID（默认 snaply 主项目）';
comment on column public.licenses.license_key is 'License 授权码（项目内唯一）';
comment on column public.licenses.expire_date is '到期时间（必填）';
comment on column public.licenses.is_active is '是否启用，默认 true';
comment on column public.licenses.max_usage is '最大使用次数，默认 1';
comment on column public.licenses.used_count is '已使用次数';
comment on column public.licenses.created_at is '创建时间';
comment on column public.licenses.last_used_at is '最近使用时间';

-- license_usage_logs
comment on column public.license_usage_logs.id is '日志 ID（自增 identity）';
comment on column public.license_usage_logs.project_id is '所属项目 ID';
comment on column public.license_usage_logs.license_key is '被校验的 License 授权码';
comment on column public.license_usage_logs.ip is '请求来源 IP';
comment on column public.license_usage_logs.user_agent is '请求 UA';
comment on column public.license_usage_logs.request_time is '请求时间';
comment on column public.license_usage_logs.result is '校验结果：valid / invalid 等';

-- user_tokens
comment on column public.user_tokens.id is 'Token ID（默认 uuid 随机生成）';
comment on column public.user_tokens.project_id is '所属项目 ID';
comment on column public.user_tokens.user_id is '归属用户 ID';
comment on column public.user_tokens.token is '令牌值（全局唯一）';
comment on column public.user_tokens.name is '令牌名称，默认「默认令牌」';
comment on column public.user_tokens.plan is '令牌授予的档位，默认 pro';
comment on column public.user_tokens.is_active is '是否启用，默认 true';
comment on column public.user_tokens.expire_date is '到期时间（必填）';
comment on column public.user_tokens.used_count is '已使用次数';
comment on column public.user_tokens.created_at is '创建时间';
comment on column public.user_tokens.last_used_at is '最近使用时间';

-- ============================================================
-- 3. 函数注释
-- ============================================================

-- bsync_*（浏览器书签同步）
comment on function public.bsync_ensure_profile(p_user uuid) is
  '确保指定用户存在档案行（不存在则插入 free 档），供注册触发器与 RPC 兜底调用。SECURITY DEFINER。';
comment on function public.bsync_handle_new_user() is
  'auth.users 插入后的触发器函数：自动为新用户创建 bsync_profiles 档案行。';
comment on function public.bsync_get_profile() is
  '返回当前登录用户的档案（plan/quota/used 等）JSONB；未登录返回 null。';
comment on function public.bsync_snapshot_push(p_data jsonb, p_tombstones jsonb, p_device text) is
  '推送当前设备全量书签：写入新快照并消费配额，返回 {version, snapshots, ...}。SECURITY DEFINER。';
comment on function public.bsync_snapshot_pull() is
  '拉取当前用户全部快照（降序），用于跨设备恢复。';
comment on function public.bsync_snapshot_restore(p_snapshot_id bigint) is
  '按快照 ID 恢复指定历史版本的书签全集。SECURITY DEFINER。';
comment on function public.bsync_touch_used(p_user uuid, p_size bigint) is
  '累加指定用户的已用空间（used_bytes），供配额统计。SECURITY DEFINER。';

-- 项目/余额（无前缀）
comment on function public.is_project_member(p_project uuid) is
  '判断当前用户是否为指定项目成员（供 RLS 策略使用）。STABLE。';
comment on function public.ensure_membership(p_project uuid) is
  '确保当前用户加入指定项目（不存在则插入成员行），供其余 SECURITY DEFINER 函数调用。';
comment on function public.add_balance(p_project uuid, p_amount numeric) is
  '为当前用户在指定项目充值余额（累加，负数归零），返回新余额；未登录返回 null。';
comment on function public.consume_balance(p_project uuid, p_amount numeric) is
  '扣减当前用户在指定项目的余额（下限 0），返回新余额；未登录返回 null。';
comment on function public.get_balance(p_project uuid) is
  '查询当前用户在指定项目的余额（无档案则先建空档案）；未登录返回 null。';

-- License/Token（无前缀）
comment on function public.consume_license(p_project uuid, p_key text) is
  '消费一个 License：校验存在/启用/未过期/未超次，成功则 used_count+1，返回结果表(ok, reason, ...)。';
comment on function public.extend_license(p_project uuid, p_key text, p_days integer) is
  '延长指定 License 到期时间 p_days 天（从当前与到期时间的较大者起算），返回更新后的信息。';
comment on function public.consume_token(p_token text) is
  '消费一个 API Token：校验存在/启用/未过期，成功则 used_count+1，返回结果表(ok, reason, plan, ...)。';
