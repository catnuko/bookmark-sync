-- ============================================================================
-- 0055 feedback_issue_repo_main.sql — 反馈 issue 同步改指主仓库
-- 日期：2026-11-07
--
-- 背景：catnuko/bookmark-sync-feedback（反馈专用仓库）已删除，catnuko/bookmark-sync
--   转为公开开源仓库，反馈同步目标改为主仓库的 issues。本迁移只 create or replace
--   触发器函数 bsync_feedback_to_github_issue()（0054 中 URL 硬编码指向旧仓库），
--   其余设计（旁路不阻塞反馈提交、Vault token、载荷函数、触发器、授权）原样沿用。
--
-- ⚠ 上线注意（人工步骤，不在迁移内）：Vault 里的 github_feedback_pat 原是仅授权
--   旧私有仓库的 fine-grained PAT。改指主仓库后需换一把对 catnuko/bookmark-sync
--   有 Issues:write 的 token（select vault.create_secret(...)，secret 名不变），
--   否则同步会静默跳过/被 GitHub 拒绝 —— 按设计不影响反馈落库，只是建不出 issue。
--
-- 幂等性：函数 OR REPLACE，可安全重放。
-- ============================================================================

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
      url => 'https://api.github.com/repos/catnuko/bookmark-sync/issues',
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
    -- 同步是旁路（对齐 0042/0054 口径）：GitHub 故障 / pg_net 未装 / vault 不可读
    -- 一律吞掉，绝不影响反馈落库
    null;
  end;

  return new;
end $$;

comment on function public.bsync_feedback_to_github_issue() is
'反馈落库后异步建 GitHub issue（0055，目标改为主仓库 catnuko/bookmark-sync，取代 0054 的旧仓库指向）：pg_net 投递即返回、不等响应；token 从 Vault 读（github_feedback_pat），缺失或任何异常一律静默跳过 —— 反馈提交本身永远不受影响。';
