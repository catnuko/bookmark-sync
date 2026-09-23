-- ============================================================================
-- scripts/analytics/activation-funnel.sql — 激活漏斗（只读）
--
-- 用法（不改任何数据）：
--   supabase db query --linked --file <仓库绝对路径>/scripts/analytics/activation-funnel.sql
--   ⚠ `--file` 的相对路径**不是**按当前 cwd 解析的（实测从 supabase/ 里跑
--     `../scripts/...` 会被解析到仓库上一级）→ 一律给绝对路径，别猜。
--
-- 为什么用现有表推导，而不是加客户端埋点：
--   这四步的**权威痕迹本来就都在服务端**。客户端埋点只会引入「安装后未登录 /
--   离线 / 上报失败」三类缺口，把漏斗算低；而且加埋点要动扩展、要过商店审核。
--     ① 注册     = 有 bsync_profiles 行（注册触发器建）
--     ② 装并登录 = 该用户名下 ≥1 台 bsync_devices
--                  （注意 bsync_devices **没有 user_id**，归属要经
--                    bsync_spaces.owner_id 才连得上）
--     ③ 成功同步 = 该用户任一空间的 bsync_op_log ≥1 行
--                  （**首推落库**才算真激活；用户点过「立即同步」但在本地就失败了，
--                    服务端不留痕 —— 这正是要测的那一段）
--     ④ 付费     = bsync_profiles.plan ∈ (plus, pro)
--                  （webhook 对 plan 的写入是**唯一生效点**，terminal 取消 / 过期会
--                    降回 free —— 见 functions/bsync-creem-webhook/index.ts:210-269。
--                    orders.status 会漏掉续费与宽限期，故不用它定义「当前有权」。）
--   D 段额外对照 ever_paid（bsync_orders.status = 'paid'），用来区分
--   「当前有权」与「曾付费后流失」—— 这两个数靠 profiles.plan 分不开。
--
-- 排除测试 / 内部账号（不排的话第一份真实读数就被污染）：
--   · bsync_admins 成员（自己的那个账号）；
--   · 邮箱匹配 %@example.com（E2E 账号 bsync-e2e@example.com）。
--   ⚠ 2026-09-23 首次跑时全库只有这两个账号 → 读数为 0 是**正确结果**，不是 bug。
--
-- 输出 = **单一结果集**（A/B/C/D 四段 UNION 在一起）。为什么不做成多条语句：
--   `supabase db query` 只回显**最后一个**结果集，多语句写法会让前面的段永远看不见。
--   合成一个结果集后，一次执行就能看全，且每段都被真正执行过（不会静默腐坏）。
-- ============================================================================

with excluded as (
    select u.id
      from auth.users u
     where u.email ilike '%@example.com'
        or exists (select 1 from public.bsync_admins a where a.user_id = u.id)
),
u as (
    select
        au.id                        as user_id,
        au.email,
        p.created_at                 as registered_at,
        p.plan                       as plan,
        (select min(d.created_at)
           from public.bsync_devices d
           join public.bsync_spaces s on s.id = d.space_id
          where s.owner_id = au.id)  as first_device_at,
        (select count(*)
           from public.bsync_devices d
           join public.bsync_spaces s on s.id = d.space_id
          where s.owner_id = au.id)  as devices,
        (select min(o.created_at)
           from public.bsync_op_log o
           join public.bsync_spaces s on s.id = o.space_id
          where s.owner_id = au.id)  as first_op_at,
        (select count(*)
           from public.bsync_op_log o
           join public.bsync_spaces s on s.id = o.space_id
          where s.owner_id = au.id)  as ops,
        exists (select 1
                  from public.bsync_orders od
                 where od.user_id = au.id and od.status = 'paid')  as ever_paid
      from auth.users au
      left join public.bsync_profiles p on p.user_id = au.id
     where au.id not in (select id from excluded)
),
f as (
    select 1 as ord, '① 注册（有 profile）' as step,
           (select count(*) from u where registered_at is not null)::numeric as cnt
    union all
    select 2, '② 装并登录（≥1 台设备）',
           (select count(*) from u where first_device_at is not null)::numeric
    union all
    select 3, '③ 成功同步一次（≥1 条 op）',
           (select count(*) from u where first_op_at is not null)::numeric
    union all
    select 4, '④ 付费（plan ∈ plus/pro）',
           (select count(*) from u where plan in ('plus', 'pro'))::numeric
),
lat as (
    select count(*)                                        as activated,
           percentile_cont(0.5) within group (
               order by extract(epoch from (first_op_at - registered_at))) as p50,
           percentile_cont(0.9) within group (
               order by extract(epoch from (first_op_at - registered_at))) as p90
      from u
     where first_op_at is not null
),
report as (
    -- ---------- A) 漏斗 ----------
    select 'A 漏斗' as section,
           ord,
           step     as item,
           cnt::int::text || ' 人（占注册 '
             || coalesce(round(100 * cnt / nullif((select cnt from f where ord = 1), 0), 1)::text, '-')
             || '%，环比上一步 '
             || coalesce(round(100 * cnt / nullif(lag(cnt) over (order by ord), 0), 1)::text, '-')
             || '%）' as detail
      from f

    union all

    -- ---------- B) 未激活清单：注册了但一条 op 都没有 ----------
    -- 唯一**可直接行动**的列表。两类卡点的修法完全不同，所以要分开标注：
    --   「从未登录设备」→ 安装 / 登录 / 门禁流程；
    --   「登录了但没同步成功」→ 同步链路（看 A 段之外的错误分布）。
    select 'B 未激活（ops = 0）',
           row_number() over (order by registered_at)::int,
           coalesce(email, '(无邮箱)'),
           '注册 ' || coalesce(registered_at::date::text, '?')
             || ' · 设备 ' || devices::text
             || ' · 卡在：'
             || case when devices = 0 then '从未登录设备' else '登录了但没同步成功' end
      from u
     where ops = 0

    union all

    -- ---------- C) 激活耗时：注册 → 首次同步落库 ----------
    -- 看中位数与 P90，不看平均数：少数极慢样本会把平均拉歪。
    -- 首同步若长期 > 1 天（86400s），说明引导流程在流失人。
    select 'C 激活耗时', 1, '已激活用户数', activated::text || ' 人' from lat
    union all
    select 'C 激活耗时', 2, '注册 → 首同步 中位',
           coalesce(round(p50)::text || ' 秒', '-') from lat
    union all
    select 'C 激活耗时', 3, '注册 → 首同步 P90',
           coalesce(round(p90)::text || ' 秒', '-') from lat

    union all

    -- ---------- D) 付费口径对照 ----------
    select 'D 付费口径对照', 1, '当前有权（profiles.plan）',
           (select count(*) from u where plan in ('plus', 'pro'))::text || ' 人'
    union all
    select 'D 付费口径对照', 2, '曾付费（orders.status = paid）',
           (select count(*) from u where ever_paid)::text || ' 人'
)

select section, item, detail
  from report
 order by section, ord;
