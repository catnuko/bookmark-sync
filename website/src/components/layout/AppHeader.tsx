'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from '@/i18n/LocaleProvider';
import { pathForLocale } from '@/i18n/paths';
import { useAccount } from '@/lib/useAccount';
import { signOut } from '@/lib/account.js';
import LocalizedLink from './LocalizedLink';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import AccountMenu from './AccountMenu';
import styles from './AppHeader.module.css';

// 隐私/条款/支持入口在页脚，页首导航只放主功能页。
// ★ 页首导航是爬虫最先看到的内链，尽量覆盖高价值落地页。
const NAV_ITEMS = [
  { key: 'nav.home', to: '/' },
  { key: 'nav.pricing', to: '/pricing' },
  { key: 'nav.download', to: '/download' },
  { key: 'nav.docs', to: '/docs' },
];

export default function AppHeader() {
  const { t } = useLocale();
  const pathname = usePathname() || '/';
  const account = useAccount();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // 归一化成中文路径再比较，/en/pricing 与 /pricing 都算 pricing 激活。
  const bare = pathForLocale(pathname, 'zh');

  async function onMobileSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      setMobileOpen(false);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <LocalizedLink to="/" className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="BookmarkSync" width={28} height={28} />
          <span className={styles.brandName}>{t('brand.name')}</span>
        </LocalizedLink>

        <nav className={styles.navDesktop}>
          {NAV_ITEMS.map((item) => (
            <LocalizedLink
              key={item.key}
              to={item.to}
              className={`${styles.navLink} ${bare === item.to ? styles.active : ''}`}
            >
              {t(item.key)}
            </LocalizedLink>
          ))}
        </nav>

        <div className={styles.headerActions}>
          <ThemeToggle />
          <LanguageToggle />
          <AccountMenu />
          <button
            className={styles.menuToggle}
            aria-label={t('common.viewAll')}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 移动端导航 */}
      {mobileOpen && (
        <nav className={styles.navMobile}>
          {NAV_ITEMS.map((item) => (
            <LocalizedLink
              key={item.key}
              to={item.to}
              className={`${styles.navLinkMobile} ${bare === item.to ? styles.active : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              {t(item.key)}
            </LocalizedLink>
          ))}
          {account.user && (
            <button
              className={`${styles.navLinkMobile} ${styles.navSignout}`}
              type="button"
              disabled={signingOut}
              onClick={onMobileSignOut}
            >
              {signingOut ? t('account.processing') : t('account.signOut')}
            </button>
          )}
        </nav>
      )}
    </header>
  );
}
