import { createI18n } from "vue-i18n";
import zh from "./zh.json";
import en from "./en.json";

const STORAGE_KEY = "bsync.locale";

function detectLocale() {
  // 1. 用户之前手动切换过 — 优先使用
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "zh" || saved === "en") return saved;

  // 2. 浏览器语言
  const browser = navigator.language.toLowerCase();
  if (browser.startsWith("zh")) return "zh";
  return "en";
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: "en",
  messages: { zh, en },
});

export function setLocale(locale) {
  i18n.global.locale.value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

export function toggleLocale() {
  const next = i18n.global.locale.value === "zh" ? "en" : "zh";
  setLocale(next);
}
