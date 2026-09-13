// 官网 Supabase 客户端 —— 与扩展共用同一个项目（URL / anon key 见扩展 src/lib/supabase.js）
// 官网是普通网页，直接用默认 localStorage 持久化登录态即可。
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://cwtqnsbpcetvqopdkcou.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_ezewylV3uHkEXOC6s-eJPg_svk8kI3H";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
