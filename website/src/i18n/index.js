import { createI18n } from 'vue-i18n';
import zh from './zh.json';
import en from './en.json';

const STORAGE_KEY = 'bsync.locale';
const isBrowser = typeof window !== 'undefined';

// CSR 直开时的语言推断：**URL 前缀优先**，其次用户手动切过的记忆，最后浏览器语言。
// URL 优先是必须的 —— 否则直接打开 /en/pricing 会被记忆覆盖成中文，
// 与 SSG 产出的静态 HTML 不一致 → hydration 报错 + 内容闪烁。
function detectLocale() {
  if (!isBrowser) return 'zh';
  const path = window.location.pathname;
  if (path === '/en' || path.startsWith('/en/')) return 'en';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'zh' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/**
 * 建一个 i18n 实例。
 *
 * SSG 必须每种语言一个**独立实例**：vue-i18n 的 locale 是单例可变状态，
 * 复用会在预渲染下一轮语言时串味。
 */
export function createI18nInstance(initial) {
  return createI18n({
    legacy: false,
    globalInjection: true,
    locale: initial || detectLocale(),
    fallbackLocale: 'en',
    messages: { zh, en },
  });
}

export const i18n = createI18nInstance();

/** 原始消息表 —— SSG 生成 FAQPage JSON-LD 时需要直接读，不走 i18n 实例。 */
export const messages = { zh, en };

/**
 * 切换语言：只改当前实例的 locale 并记住偏好，**不做 URL 跳转**。
 * 跳转由调用方（LanguageToggle）负责 —— 语言前缀与路由的映射只有它知道。
 */
export function setLocale(instance, locale) {
  instance.global.locale.value = locale;
  if (isBrowser) {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }
}
