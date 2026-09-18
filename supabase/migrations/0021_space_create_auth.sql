-- 0021 space_create_auth.sql — bsync_space_create 认证检查 + 首空间自动默认
-- 背景：0017 的 bsync_space_create 为极简版（无认证检查）。扩展 SW 冷启动时
--       supabase 客户端 session 异步恢复，若 runSync 在恢复完成前调用 RPC，
--       请求以 anon（无 JWT）执行 → auth.uid() 为 null → INSERT owner_id NULL
--       违反 NOT NULL 约束（首次同步自动建「默认空间」时必然报错）。
--       本迁移补认证检查、名称校验、首空间自动 is_default，并收紧执行权限
--       （与前端 runSync 的 getSession 就绪检查配套，双保险）。
-- 幂等性：OR REPLACE / REVOKE / GRANT，可安全重放。
-- 范围：仅 bsync_space_create（本租户）。

create or replace function public.bsync_space_create(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner uuid;
    v_count int;
    v_row   public.bsync_spaces;
begin
    v_owner := auth.uid();
    if v_owner is null then
        raise exception 'not authenticated';
    end if;

    p_name := btrim(coalesce(p_name, ''));
    if p_name = '' or length(p_name) > 50 then
        raise exception 'invalid_name';
    end if;

    -- 首个空间自动设为默认（与 0014 语义一致：is_default 每用户至多一个）
    select count(*) into v_count from public.bsync_spaces where owner_id = v_owner;

    insert into public.bsync_spaces (owner_id, name, is_default)
    values (v_owner, p_name, v_count = 0)
    returning * into v_row;

    return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'is_default', v_row.is_default);
end;
$$;

comment on function public.bsync_space_create(text) is
'创建同步空间（属主 = 当前用户）；未认证抛 not authenticated；首个空间自动 is_default；名称 1-50 字符';

revoke execute on function public.bsync_space_create(text) from public;
grant execute on function public.bsync_space_create(text) to authenticated;
