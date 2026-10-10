/**
 * 轻量 i18n 运行时 —— 取代 vue-i18n。
 *
 * 复用现有 zh.json / en.json（键结构不变），只提供一个纯函数式取值 + 插值。
 * ★ 关键：vue-i18n 会把字面量 '@' 转义成 {'@'}（如 support{'@'}bookmark-sync.top）。
 *   我们的 t() 不特殊处理 '@'，所以必须把 {'@'} 反转义回 '@'，否则邮箱会渲染成
 *   support{'@'}bookmark-sync.top。
 */
import zh from './zh.json';
import en from './en.json';

export type Locale = 'zh' | 'en';
export const LOCALES: Locale[] = ['zh', 'en'];
export const messages = { zh, en } as const;
export type Messages = typeof zh;

export type Vars = Record<string, string | number>;

function lookup(dict: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), dict);
}

/** vue-i18n 的 {'@'} / {"@"} 转义 → 还原为 '@'。 */
function unescapeAt(s: string): string {
  return s.replace(/\{['"]@['"]\}/g, '@');
}

function deepUnescape<T>(v: T): T {
  if (typeof v === 'string') return unescapeAt(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepUnescape(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = deepUnescape(val);
    return out as T;
  }
  return v;
}

/** 取字符串并做 {var} 插值。取不到或非字符串时回退为 key 本身（便于定位缺失键）。 */
export function t(dict: unknown, key: string, vars: Vars = {}): string {
  const v = lookup(dict, key);
  if (typeof v !== 'string') return key;
  const interpolated = v.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
  );
  return unescapeAt(interpolated);
}

/** 取原始数组/对象（含深层字符串的 {'@'} 反转义）。 */
export function tm(dict: unknown, key: string): unknown {
  return deepUnescape(lookup(dict, key));
}

/** 绑定某个 locale 的 t —— server component 直接用，避免依赖 context。 */
export function makeT(locale: Locale) {
  const dict = messages[locale] ?? messages.zh;
  return (key: string, vars?: Vars) => t(dict, key, vars);
}

/** 绑定某个 locale 的 tm。 */
export function makeTm(locale: Locale) {
  const dict = messages[locale] ?? messages.zh;
  return (key: string) => tm(dict, key);
}
