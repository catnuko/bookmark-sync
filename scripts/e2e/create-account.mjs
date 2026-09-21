#!/usr/bin/env node
/**
 * scripts/e2e/create-account.mjs — 创建 / 修复 e2e 专用测试账号（**幂等**）。
 *
 * 为什么需要这个脚本：建账号**没有官方 CLI 通道**（`supabase --help` 里没有 auth
 * 管理子命令），只能直接写 auth schema。而直接写有四个易错点，踩过一次就够：
 *   1. 密码必须 `extensions.crypt(pw, extensions.gen_salt('bf'))` —— pgcrypto 装在
 *      extensions schema，少了前缀会报 `function crypt(text, text) does not exist`；
 *   2. **必须同时建 `auth.identities`**，否则 GoTrue 找不到身份，登录报
 *      Invalid login credentials（密码明明是对的）；
 *   3. 必须设 `email_confirmed_at`，否则登录报 Email not confirmed；
 *   4. bind-gate 场景断言「付费档才给新建空间入口」，而 profile 的 plan 默认是 free，
 *      要提到 pro —— 否则场景会在最前面就失败。
 *
 * 幂等语义：账号状态 == e2e.env 描述的状态。已存在时**同步密码**、补齐 identity，
 * 缺失的 profile 补一条，并把 plan 提到 pro。换环境 / 账号被误删时，一条命令重建。
 *
 * 用法：node scripts/e2e/create-account.mjs
 */
import { getConfig, requireCredentials } from './lib/env.mjs';
import * as cloud from './lib/cloud.mjs';

const cfg = getConfig();
requireCredentials(cfg);

if (!cloud.cliAvailable()) {
  console.error('找不到 supabase CLI —— 本脚本要走 `supabase db query --linked` 直连远端');
  process.exit(1);
}

/** 转义成 SQL 字符串字面量（email/password 里可能有单引号）。 */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const email = cfg.email;
const password = cfg.password;

const existed = cloud
  .sql(`select id from auth.users where lower(email) = lower(${lit(email)})`)
  .at(0)?.id;
console.log(existed ? `账号已存在，同步状态：${email}` : `创建账号：${email}`);

cloud.exec(`
do $$
declare
  uid uuid;
  e   text := ${lit(email)};
  pw  text := ${lit(password)};
begin
  select id into uid from auth.users where lower(email) = lower(e);

  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- ⚠ 这四个 token 列**必须显式给空串**（GoTrue 自己建用户时也是空串）：
      -- GoTrue 登录时会读它们，遇到 NULL 不是返回 401，而是请求整体失败。
      -- 而扩展的 store.submit() 只有 try/finally、没有 catch，异常直接冒泡出去 →
      -- 现象是「停在登录页，且页面上没有任何错误提示」，排查时极易误判成密码错。
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      e, extensions.crypt(pw, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      '', '', '', ''
    );
  else
    -- e2e.env 是密码的唯一真源：改了这里就同步过去，避免「脚本说改好了但其实没改」。
    update auth.users
       set encrypted_password = extensions.crypt(pw, extensions.gen_salt('bf')),
           email_confirmed_at  = coalesce(email_confirmed_at, now()),
           -- 顺手把 NULL 的 token 列补成空串（原因见上面 insert 处的说明）。
           -- 于是「账号状态坏了」也能靠重跑本脚本修好，不用手工进 SQL 查。
           confirmation_token     = coalesce(confirmation_token, ''),
           recovery_token         = coalesce(recovery_token, ''),
           email_change           = coalesce(email_change, ''),
           email_change_token_new = coalesce(email_change_token_new, ''),
           updated_at             = now()
     where id = uid;
    -- 重建 identity 而不是 upsert：provider_id 在换 uid 时会变，删干净最省事。
    delete from auth.identities where user_id = uid and provider = 'email';
  end if;

  -- GoTrue 按 (provider, provider_id) 定位身份；provider_id 用 uid 文本形式
  -- （GoTrue 自己建用户时也是这么写的）。
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid,
    jsonb_build_object('sub', uid::text, 'email', e, 'email_verified', true),
    'email', uid::text, now(), now(), now()
  );

  -- profile 通常由 auth.users 上的 on_auth_user_created 触发器建好；这里兜底
  -- （账号早于触发器存在、或被手工清理过的情况），并保证是付费档。
  insert into public.bsync_profiles (user_id) values (uid)
    on conflict (user_id) do nothing;
  update public.bsync_profiles set plan = 'pro' where user_id = uid;
end $$;`);

const uid = cloud
  .sql(`select id from auth.users where lower(email) = lower(${lit(email)})`)
  .at(0)?.id;
const prof = cloud.profile(uid);
const identities = cloud
  .sql(
    `select count(*)::int as n from auth.identities i
     join auth.users u on u.id = i.user_id
    where lower(u.email) = lower(${lit(email)}) and i.provider = 'email'`,
  )
  .at(0)?.n;

console.log('\n✓ 账号就绪');
console.log(`  email      : ${prof?.email ?? email}`);
console.log(`  uid        : ${uid}`);
console.log(`  plan       : ${prof?.plan}${prof?.plan === 'pro' ? '' : '  ⚠ bind-gate 需要 pro'}`);
console.log(
  `  email 已确认: ${prof ? '是（登录不会报 Email not confirmed）' : '否 —— profile 缺失'}`,
);
console.log(`  identity   : ${identities} 条（0 条会导致 Invalid login credentials）`);
