// 黑白（深浅色）主题切换：localStorage 持久化，首次访问跟随系统。
// （迁移前 src/theme.js 的 TS 移植，行为不变。）
const STORAGE_KEY = 'bsync.theme';

export type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // 同步浏览器地址栏/状态栏颜色
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme === 'dark' ? '#09090b' : '#ffffff';
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function toggleTheme(): void {
  const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
}
