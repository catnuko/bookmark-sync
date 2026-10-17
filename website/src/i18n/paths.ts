import type { Locale } from './t';

/**
 * 从路径推导 locale：/en/* → 'en'，其余 → 'zh'。
 * 与迁移前 src/router/routes.js 的 localeFromPath 完全一致。
 */
export function localeFromPath(path: string): Locale {
  return path === '/en' || path.startsWith('/en/') ? 'en' : 'zh';
}

/**
 * 生成某 locale 下的 URL。英文是**前缀** /en/*，不是后缀。
 *   ('/pricing','en') → '/en/pricing'   ('/pricing','zh') → '/pricing'
 *   ('/','en')        → '/en'           ('/','zh')        → '/'
 *   ('/en/pricing','zh') → '/pricing'   ('/en','zh')      → '/'
 */
export function pathForLocale(path: string, locale: Locale): string {
  const bare = path === '/en' || path.startsWith('/en/') ? path.slice(3) || '/' : path;
  const clean = bare === '/' ? '' : bare.replace(/\/$/, '');
  if (locale !== 'en') return clean || '/';
  return clean ? `/en${clean}` : '/en';
}
