'use client';

import { createContext, useContext, useMemo } from 'react';
import { messages, t as translate, tm as translateRaw, type Locale, type Vars } from './t';

type LocaleCtx = {
  locale: Locale;
  t: (key: string, vars?: Vars) => string;
  tm: (key: string) => unknown;
};

const Ctx = createContext<LocaleCtx | null>(null);

/**
 * 客户端组件用的 locale 上下文。locale 由所在语言树的 root layout 静态传入。
 * server component 不用这个 —— 它们用 makeT(locale) 直接绑定（见 i18n/t.ts）。
 */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo<LocaleCtx>(() => {
    const dict = messages[locale];
    return {
      locale,
      t: (key, vars) => translate(dict, key, vars),
      tm: (key) => translateRaw(dict, key),
    };
  }, [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale(): LocaleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLocale 必须在 <LocaleProvider> 内使用');
  return ctx;
}
