-- ============================================================================
-- 0054 github_issue_sync.sql — 新反馈自动同步为 GitHub issue
-- 日期：2026-10-31
--
-- 背景：反馈目前只有两个消费口 —— 工作台 /api/feedback 面板（0045）和数据库本身，
--   都需要**主动打开**才能看到。负责人希望「有新反馈 → 邮箱收到通知 + 一个直观的
--   集中地」。方案：私有仓库 catnuko/bookmark-sync-feedback 的 issue（GitHub 会把
--   issue 动态推送到负责人邮箱，回复用户也可在面板/邮件里完成）。
--
-- 为什么放数据库触发器而不是插件端：反馈写入链路是 插件 → bsync_submit_feedback
--   RPC（0045）直落库，中间没有我们的服务器；放触发器**不用改插件、不用发新版**，
--   新反馈一落库就同步。放 RPC 里做则把 GitHub 故障耦合进提交路径 —— 不可接受。
--
-- 设计要点（改本文件前先读）：
--   · 旁路口径对齐 0042：触发器绝不能让反馈提交失败。pg_net 异步天然满足
--     （http_post 只投递请求、不等待响应），函数体内再套一层 exception 兜底，
--     双保险 —— GitHub 不可达 / token 缺失 / pg_net 未装 都静默跳过。
--   · token 存 Supabase Vault（secret 名固定 github_feedback_pat），不进迁移、
--     不进 git、不进任何环境变量。secret 不存在 = 功能未开通 → 静默跳过。
--   · 标题/正文/labels 形状抽进 bsync_feedback_issue_payload（纯函数）：
--     本地验证可直接 select 断言 JSON 形状，不必依赖 GitHub 的响应。
--   · 隐私口径沿用 0045：只包含反馈正文 + 白名单元数据（app_version / platform /
--     locale / last_error_phase）+ 邮箱（回信邮箱 + 提交者账号邮箱）。仓库私有，
--     负责人知情同意；**绝不新增任何书签数据、网址、E2EE 明文**。
--   · schema 兼容：pg_net 在不同安装形态下可能落在 net 或 extensions schema，
--     触发器函数 search_path 两个都带上（不存在的 schema 会被静默忽略）；
--     调 http_post 不带 schema 限定，由 search_path 解析。
--
-- 上线步骤（人工执行，本地已完成占位 token 的链路验证）：
--   1) supabase db push            -- 应用本迁移（只建触发器，不含 token）
--   2) 换真 token（Fine-grained PAT，仅 Issues:write 授权该私有仓库）：
--        select vault.create_secret('<GitHub PAT>', 'github_feedback_pat');
--      （若旧 secret 已存在：先 select id from vault.secrets where name='github_feedback_pat';
--        再 select vault.remove_secret('<id>'); 然后重建）
--   3) 冒烟：插件提交一条反馈 → 确认仓库出现对应 issue。
--
-- 幂等性：extension IF NOT EXISTS / function OR REPLACE / trigger DROP+CREATE，
--   可安全重放。在无 pg_net / 无 vault 的裸 Postgres 重放环境（verify-sync-local）
--   中，extension 创建降级为 notice，触发器建得出来但运行时静默跳过 —— 重放不破。
-- 自检 SQL：见文件末注释块。
-- ============================================================================

-- ---------- 0) pg_net（重放安全：裸 Postgres 没有，降级为 notice） ----------
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net 不可用，GitHub issue 同步将在运行时静默跳过: %', sqlerrm;
end $$;

-- ---------- 1) issue 载荷构造（纯函数，供触发器与本地形状断言共用） ----------
create or replace function public.bsync_feedback_issue_payload(f public.bsync_feedback)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'title', '[' || f.kind || '] '
      || left(regexp_replace(f.body, E'[\\r\\n]+', ' ', 'g'), 60),
    'body', concat_ws(E'\n',
      '## 反馈内容',
      '',
      f.body,
      '',
      '## 环境',
      '- 类型: ' || f.kind,
      '- 插件版本: ' || coalesce(nullif(f.app_version, ''), '未知'),
      '- 平台: ' || coalesce(nullif(f.platform, ''), '未知'),
      '- 语言: ' || coalesce(nullif(f.locale, ''), '未知'),
      '- 最近错误阶段: ' || coalesce(nullif(f.last_error_phase, ''), '无'),
      '- 回信邮箱: ' || coalesce(f.contact_email, '未提供'),
      '- 账号邮箱: ' || coalesce(
           (select u.email from auth.users u where u.id = f.user_id), '未知'),
      '- 提交时间: '
        || to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ),
    'labels', jsonb_build_array(f.kind)
  );
$$;

comment on function public.bsync_feedback_issue_payload(public.bsync_feedback) is
'构造 GitHub issue 请求载荷（0054）：标题 = [kind] + 正文前 60 字（换行折叠），正文 = 反馈全文 + 0045 白名单元数据 + 邮箱，labels = kind 对应标签。纯函数，独立出来便于本地断言 JSON 形状。SECURITY DEFINER 仅因需读 auth.users 带出账号邮箱；EXECUTE 已全量收回，任何客户端角色都调不到。';

-- ---------- 2) 触发器函数（旁路：任何失败都不影响反馈提交） ----------
create or replace function public.bsync_feedback_to_github_issue()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions, pg_temp
as $$
declare
  v_token   text;
  v_payload jsonb;
begin
  begin
    select btrim(decrypted_secret) into v_token
      from vault.decrypted_secrets
     where name = 'github_feedback_pat'
     limit 1;

    -- 未配置 token：功能未开通，静默跳过
    if v_token is null or v_token = '' then
      return new;
    end if;

    v_payload := public.bsync_feedback_issue_payload(new);

    perform http_post(
      url => 'https://api.github.com/repos/catnuko/bookmark-sync-feedback/issues',
      body => v_payload,
      headers => jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Accept', 'application/vnd.github+json',
        'Content-Type', 'application/json',
        'User-Agent', 'bookmark-sync-feedback-sync'
      ),
      timeout_milliseconds => 5000
    );
  exception when others then
    -- 同步是旁路（对齐 0042 口径）：GitHub 故障 / pg_net 未装 / vault 不可读
    -- 一律吞掉，绝不影响反馈落库
    null;
  end;

  return new;
end $$;

comment on function public.bsync_feedback_to_github_issue() is
'反馈落库后异步建 GitHub issue（0054）：pg_net 投递即返回、不等响应；token 从 Vault 读（github_feedback_pat），缺失或任何异常一律静默跳过 —— 反馈提交本身永远不受影响。';

-- ---------- 3) 触发器 ----------
drop trigger if exists bsync_feedback_github_issue_sync on public.bsync_feedback;
create trigger bsync_feedback_github_issue_sync
  after insert on public.bsync_feedback
  for each row
  execute function public.bsync_feedback_to_github_issue();

-- ---------- 4) 函数 EXECUTE 授权（对齐 TENANTS 规范：显式收回 PUBLIC 默认授权） ----------
-- 触发器函数由触发器机制调用、载荷函数只被触发器函数（owner 身份）调用，
-- 客户端角色一律无 EXECUTE。
revoke all on function public.bsync_feedback_issue_payload(public.bsync_feedback)
  from public, anon, authenticated;
revoke all on function public.bsync_feedback_to_github_issue()
  from public, anon, authenticated;

-- ============================================================================
-- 自检 SQL（本地 supabase 栈，占位 token 场景；详见
-- scripts/verify-sync-local/scenario-0054-github-issue-sync.sql）：
--
--   -- ① 载荷形状（不经网络，直接断言）
--   select public.bsync_feedback_issue_payload(f) from public.bsync_feedback f
--    order by id desc limit 1;
--   -- 期望：title 形如 [bug] xxx（无换行，≤64 字符）；body 含全文与全部白名单元数据；
--   --       labels == [kind]
--
--   -- ② 链路：提交反馈后数秒内 net.http_response 应出现 401（占位 token 被 GitHub 拒）
--   select status_code, left(content::text, 120)
--     from net.http_response order by id desc limit 1;
--   -- 期望：401 | {"message":"Bad credentials",...} —— 证明请求已达 api.github.com
--   --       且 Bearer 头已带上；换真 token 后同路径应得 201。
--
--   -- ③ role-play（TENANTS #10）：客户端角色调不到载荷/触发器函数
--   select has_function_privilege('authenticated',
--     'public.bsync_feedback_issue_payload(public.bsync_feedback)', 'EXECUTE');
--   -- 期望：f
-- ============================================================================
