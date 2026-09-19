-- 0019 e2ee_salt.sql — E2EE 口令模式：salt 云端流转（按用户同步）
-- 背景：口令模式（PBKDF2-SHA256）要求所有设备共享同一随机 salt，才能用同一
--       口令派生出同一密钥。salt 是非机密公开值（keyManager 设计注释明确
--       "salt is not secret — it just makes rainbow-table / cross-user
--       dictionary attacks useless"），因此存云端按用户同步；密钥始终只在
--       设备本地由「口令 + salt」派生，服务器/传输层不见密钥。
--       新设备：登录 → bsync_get_e2ee_salt 拉盐 → 输入口令 → 本地派生 → 解密。
-- 幂等性：ADD COLUMN IF NOT EXISTS / OR REPLACE，可安全重放。
-- 范围：仅 bsync_* 前缀（本租户）。

-- ---------- 1) bsync_profiles.e2ee_salt（口令派生盐，base64url(16B)） ----------
ALTER TABLE public.bsync_profiles ADD COLUMN IF NOT EXISTS e2ee_salt text;

-- 读取当前用户口令盐（无则 NULL）
CREATE OR REPLACE FUNCTION public.bsync_get_e2ee_salt()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
  v_salt text;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT e2ee_salt INTO v_salt FROM public.bsync_profiles WHERE user_id = v_user;
  RETURN v_salt;
END; $$;
COMMENT ON FUNCTION public.bsync_get_e2ee_salt() IS '返回当前用户的口令派生盐（base64url，非机密）；无则 NULL';

-- 写入当前用户口令盐（仅属主可写；RLS 走 SECURITY DEFINER + auth.uid 校验）
CREATE OR REPLACE FUNCTION public.bsync_set_e2ee_salt(p_salt text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_salt IS NULL OR length(p_salt) < 16 THEN
    RAISE EXCEPTION 'invalid e2ee salt';
  END IF;
  INSERT INTO public.bsync_profiles (user_id, e2ee_salt)
  VALUES (auth.uid(), p_salt)
  ON CONFLICT (user_id) DO UPDATE SET e2ee_salt = EXCLUDED.e2ee_salt;
END; $$;
COMMENT ON FUNCTION public.bsync_set_e2ee_salt(text) IS '写入当前用户的口令派生盐（仅属主；长度≥16 校验）';
