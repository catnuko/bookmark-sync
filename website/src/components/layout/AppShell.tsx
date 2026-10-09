import type { Locale } from '@/i18n/t';
import AppHeader from './AppHeader';
import AppFooter from './AppFooter';
import styles from './AppShell.module.css';

/**
 * 公开站外壳（header + main + footer）。server component —— locale 由所在语言树传入。
 * AppHeader 是 client component，靠 <LocaleProvider> 上下文取 locale。
 */
export default function AppShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <AppHeader />
      <main className={styles.main}>{children}</main>
      <AppFooter locale={locale} />
    </div>
  );
}
