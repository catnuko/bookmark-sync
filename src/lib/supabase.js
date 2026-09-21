// Supabase 客户端 —— 复用官方 Auth（邮箱 + 密码），登录态持久化到 chrome.storage.local
// 这样选项页（页面上下文）与后台 service worker 共享同一份会话，令牌过期会自动刷新。
import { createClient } from '@supabase/supabase-js';
import { api } from './ext.js';

export const SUPABASE_URL = 'https://cwtqnsbpcetvqopdkcou.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ezewylV3uHkEXOC6s-eJPg_svk8kI3H';

// 用 chrome.storage.local 替代默认的 localStorage（service worker 里没有 localStorage）
const storage = {
  async getItem(key) {
    return (await api.storage.local.get(key))[key] ?? null;
  },
  async setItem(key, value) {
    await api.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await api.storage.local.remove(key);
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
