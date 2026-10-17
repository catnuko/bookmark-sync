'use client';

// 语言切换 = **跳转到对应语言的 URL**，不是原地换文案。
// canonical 与 hreflang 只有在两种语言各有独立 URL 时才成立。跨语言树切换是整页刷新。
import { usePathname } from 'next/navigation';
import { useLocale } from '@/i18n/LocaleProvider';
import { pathForLocale } from '@/i18n/paths';
import styles from './LanguageToggle.module.css';

export default function LanguageToggle() {
  const { locale, t } = useLocale();
  const pathname = usePathname() || '/';
  const next = locale === 'zh' ? 'en' : 'zh';
  const label = next === 'en' ? 'English' : '中文';

  return (
    <a className={styles.langToggle} href={pathForLocale(pathname, next)} title={t('lang.switch')}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path
          d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      <span className={styles.langLabel}>{label}</span>
    </a>
  );
}
