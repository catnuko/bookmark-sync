-- ============================================================================
-- bookmark-sync v2 schema 迁移（Move-CRDT + 操作日志模型）
-- 日期：2026-09-14
-- 范围：仅 bsync_* 前缀对象（本仓库相关）。lic_* / profiles / projects 等一律不动。
-- 变更：删除旧「全量快照 + 墓碑」模型（bsync_snapshots / bsync_tombstones 等），
--       新建「操作日志 + 快照 GC」模型：bsync_op_log 为 v2 核心表。
-- 执行方式：Supabase Dashboard → SQL Editor 粘贴执行；或 supabase CLI / Management API。
-- ============================================================================

-- ---------- 1) 旧触发器（挂在 auth.users 上） ----------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- ---------- 2) 旧函数 ----------
DROP FUNCTION IF EXISTS public.bsync_device_remove(text);
DROP FUNCTION IF EXISTS public.bsync_device_rename(text, text);
DROP FUNCTION IF EXISTS public.bsync_device_touch(text, text, uuid);
DROP FUNCTION IF EXISTS public.bsync_ensure_profile(uuid);
DROP FUNCTION IF EXISTS public.bsync_get_profile();
DROP FUNCTION IF EXISTS public.bsync_handle_new_user();
DROP FUNCTION IF EXISTS public.bsync_snapshot_pull(uuid);
DROP FUNCTION IF EXISTS public.bsync_snapshot_push(jsonb, jsonb, text, uuid, text);
DROP FUNCTION IF EXISTS public.bsync_snapshot_restore(bigint);
DROP FUNCTION IF EXISTS public.bsync_space_create(text);
DROP FUNCTION IF EXISTS public.bsync_space_delete(uuid);
DROP FUNCTION IF EXISTS public.bsync_space_rename(uuid, text);
DROP FUNCTION IF EXISTS public.bsync_touch_used(uuid, bigint);

-- ---------- 3) 旧表 ----------
DROP TABLE IF EXISTS public.bsync_devices CASCADE;
DROP TABLE IF EXISTS public.bsync_orders CASCADE;
DROP TABLE IF EXISTS public.bsync_profiles CASCADE;
DROP TABLE IF EXISTS public.bsync_snapshots CASCADE;
DROP TABLE IF EXISTS public.bsync_spaces CASCADE;
DROP TABLE IF EXISTS public.bsync_subscriptions CASCADE;
DROP TABLE IF EXISTS public.bsync_tombstones CASCADE;

-- ============================================================================
-- v2 新 schema
-- ============================================================================

-- ---------- 4) 同步空间 ----------
CREATE TABLE public.bsync_spaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bsync_spaces_owner_idx ON public.bsync_spaces(owner_id);

-- ---------- 5) 设备 ----------
CREATE TABLE public.bsync_devices (
  id           uuid PRIMARY KEY,
  space_id     uuid NOT NULL REFERENCES public.bsync_spaces(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT '',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, id)
);
CREATE INDEX bsync_devices_space_idx ON public.bsync_devices(space_id);

-- ---------- 6) 操作日志（v2 核心表） ----------
-- op 字段存 Move-CRDT 操作序列化：{"t":{"counter":n,"replica":r},"p":父UUID,"m":元数据,"c":子UUID}
-- seq 为设备内单调递增序号；服务端以 (id) 作为全局游标拉取增量。
CREATE TABLE public.bsync_op_log (
  id         bigserial PRIMARY KEY,
  space_id   uuid NOT NULL REFERENCES public.bsync_spaces(id) ON DELETE CASCADE,
  device_id  uuid NOT NULL,
  seq        bigint NOT NULL,
  op         jsonb NOT NULL,
  cid        text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, device_id, seq)
);
CREATE INDEX bsync_op_log_space_id_idx     ON public.bsync_op_log(space_id, id);
CREATE INDEX bsync_op_log_space_device_idx ON public.bsync_op_log(space_id, device_id, seq);

-- ---------- 7) 快照（GC 用：操作日志截断后，新设备/回放以此重建） ----------
CREATE TABLE public.bsync_snapshots (
  id           bigserial PRIMARY KEY,
  space_id     uuid NOT NULL REFERENCES public.bsync_spaces(id) ON DELETE CASCADE,
  after_op_id  bigint,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bsync_snapshots_space_idx ON public.bsync_snapshots(space_id, id);

-- ---------- 8) 用户资料（额度/计划） ----------
CREATE TABLE public.bsync_profiles (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan         text NOT NULL DEFAULT 'free',
  quota_bytes  bigint NOT NULL DEFAULT 0,
  used_bytes   bigint NOT NULL DEFAULT 0,
  purchased_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- 9) 计费（Creem，结构与旧版兼容） ----------
CREATE TABLE public.bsync_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                  text NOT NULL,
  creem_checkout_id     text,
  creem_order_id        text,
  creem_subscription_id text,
  creem_customer_id     text,
  amount_cents          integer,
  currency              text,
  status                text,
  event_type            text,
  payload               jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bsync_orders_user_idx ON public.bsync_orders(user_id);

CREATE TABLE public.bsync_subscriptions (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                  text NOT NULL,
  status                text NOT NULL,
  creem_subscription_id text,
  creem_customer_id     text,
  current_period_end    timestamptz,
  canceled_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE public.bsync_spaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bsync_devices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bsync_op_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bsync_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bsync_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bsync_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bsync_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY spaces_owner  ON public.bsync_spaces
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY devices_owner ON public.bsync_devices
  FOR ALL USING (space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid()))
  WITH CHECK (space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid()));
CREATE POLICY oplog_owner   ON public.bsync_op_log
  FOR ALL USING (space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid()))
  WITH CHECK (space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid()));
CREATE POLICY snapshots_owner ON public.bsync_snapshots
  FOR ALL USING (space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid()))
  WITH CHECK (space_id IN (SELECT id FROM public.bsync_spaces WHERE owner_id = auth.uid()));
CREATE POLICY profiles_owner ON public.bsync_profiles
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY orders_owner ON public.bsync_orders
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY subs_owner ON public.bsync_subscriptions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- RPC 函数
-- ============================================================================

-- 新用户自动建 profile（挂在 auth.users 触发器）
CREATE OR REPLACE FUNCTION public.bsync_handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bsync_profiles (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.bsync_handle_new_user();

-- 当前用户资料
CREATE OR REPLACE FUNCTION public.bsync_get_profile()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(p) FROM public.bsync_profiles p WHERE p.user_id = auth.uid();
$$;

-- 空间
CREATE OR REPLACE FUNCTION public.bsync_space_create(p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_space public.bsync_spaces;
BEGIN
  INSERT INTO public.bsync_spaces (owner_id, name) VALUES (auth.uid(), p_name)
  RETURNING * INTO v_space;
  RETURN to_jsonb(v_space);
END; $$;

CREATE OR REPLACE FUNCTION public.bsync_space_rename(p_space uuid, p_name text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.bsync_spaces SET name = p_name, updated_at = now()
  WHERE id = p_space AND owner_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.bsync_space_delete(p_space uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.bsync_spaces WHERE id = p_space AND owner_id = auth.uid();
$$;

-- 设备注册 / 心跳
CREATE OR REPLACE FUNCTION public.bsync_device_touch(p_space uuid, p_device uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bsync_spaces WHERE id = p_space AND owner_id = auth.uid()) THEN
    RETURN;
  END IF;
  INSERT INTO public.bsync_devices (id, space_id, name) VALUES (p_device, p_space, p_name)
  ON CONFLICT (space_id, id) DO UPDATE SET name = EXCLUDED.name, last_seen_at = now();
END; $$;

-- 移除设备
CREATE OR REPLACE FUNCTION public.bsync_device_remove(p_device uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.bsync_devices d USING public.bsync_spaces s
  WHERE d.id = p_device AND d.space_id = s.id AND s.owner_id = auth.uid();
$$;

-- 操作日志：批量追加（幂等去重；仅空间属主可写）
CREATE OR REPLACE FUNCTION public.bsync_op_push(p_space uuid, p_device uuid, p_ops jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows int; v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('inserted', 0, 'denied', true);
  END IF;
  INSERT INTO public.bsync_op_log (space_id, device_id, seq, op, cid)
  SELECT p_space, p_device, (elem->>'seq')::bigint, elem->'op', elem->>'cid'
  FROM jsonb_array_elements(p_ops) elem
  ON CONFLICT (space_id, device_id, seq) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('inserted', v_rows);
END; $$;

-- 操作日志：按游标拉取增量（id > p_after_id，按 id 升序，可分页）
CREATE OR REPLACE FUNCTION public.bsync_op_pull(p_space uuid, p_after_id bigint, p_limit int DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_rows jsonb; v_last bigint; v_more boolean;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('denied', true);
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT id, device_id, seq, op, cid, created_at
        FROM public.bsync_op_log
        WHERE space_id = p_space AND id > p_after_id
        ORDER BY id LIMIT p_limit) t;
  SELECT COALESCE(max(id), p_after_id) INTO v_last FROM public.bsync_op_log
    WHERE space_id = p_space AND id > p_after_id;
  SELECT EXISTS(SELECT 1 FROM public.bsync_op_log
                WHERE space_id = p_space AND id > v_last) INTO v_more;
  RETURN jsonb_build_object('rows', v_rows, 'last_id', v_last, 'has_more', COALESCE(v_more, false));
END; $$;

-- 快照：保存（GC 后供新设备/回放重建）
CREATE OR REPLACE FUNCTION public.bsync_snapshot_push(p_space uuid, p_after_op_id bigint, p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_id bigint;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('denied', true);
  END IF;
  INSERT INTO public.bsync_snapshots (space_id, after_op_id, data)
  VALUES (p_space, p_after_op_id, p_data)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('snapshot_id', v_id);
END; $$;

-- 快照：拉取（最新快照 + 当前操作日志水位）
CREATE OR REPLACE FUNCTION public.bsync_snapshot_pull(p_space uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_snap public.bsync_snapshots; v_head bigint;
BEGIN
  SELECT owner_id INTO v_owner FROM public.bsync_spaces WHERE id = p_space;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('denied', true);
  END IF;
  SELECT * INTO v_snap FROM public.bsync_snapshots
    WHERE space_id = p_space ORDER BY id DESC LIMIT 1;
  SELECT COALESCE(max(id), 0) INTO v_head FROM public.bsync_op_log WHERE space_id = p_space;
  RETURN jsonb_build_object('snapshot', to_jsonb(v_snap), 'head_op_id', v_head);
END; $$;
