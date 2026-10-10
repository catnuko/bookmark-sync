'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/i18n/LocaleProvider';
import { toggleTheme } from '@/lib/theme';
import styles from './ThemeToggle.module.css';

export default function ThemeToggle() {
  const { t } = useLocale();
  // 服务端与首帧都渲染「月亮」（isDark=false）→ 不会 hydration mismatch；
  // 挂载后再从 <html data-theme> 同步真实值。
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  function onClick() {
    toggleTheme();
    setIsDark(document.documentElement.dataset.theme === 'dark');
  }

  return (
    <button
      className={styles.themeToggle}
      type="button"
      title={t('theme.switch')}
      aria-label={t('theme.switch')}
      onClick={onClick}
    >
      {isDark ? (
        // 太阳：深色模式下点击切回浅色
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // 月亮：浅色模式下点击切入深色
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path
            d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
