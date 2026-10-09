'use client';

// 官网账户菜单 —— 页首右上角的登录态入口。
// 把「登录 / 看状态 / 登出」补成常态入口，不依赖先滚到定价页。
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from '@/i18n/LocaleProvider';
import { useAccount } from '@/lib/useAccount';
import { openPortal, signOut } from '@/lib/account.js';
import { startAdminAuth } from '@/admin/lib/auth.js';
import { useAdminAuth } from '@/admin/lib/useAdminAuth';
import AccountDialog from './AccountDialog';
import LocalizedLink from './LocalizedLink';
import styles from './AccountMenu.module.css';

export default function AccountMenu() {
  const { t } = useLocale();
  const account = useAccount();
  const adminAuth = useAdminAuth();
  const [open, setOpen] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  // adminAuth 是模块级单例；页面加载时启动一次鉴权（幂等）。
  useEffect(() => {
    startAdminAuth();
  }, []);

  // 点击外部 / Esc 关闭。
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const signedIn = !!account.user;
  const isAdmin = !!adminAuth.user && !!adminAuth.isAdmin;
  // plan 为 null = 拉取失败，**不是** free。
  const planKey = account.error ? 'account.planUnknown' : `pricing.plans.${account.plan || 'free'}.name`;
  const hasActiveSub =
    !!account.subscription &&
    ['active', 'scheduled_cancel', 'past_due'].includes(account.subscription.status);

  async function onManage() {
    if (busy) return;
    setError('');
    setBusy(true);
    setOpen(false);
    try {
      const url = await openPortal();
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError((e as Error)?.message || t('account.portalFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signOut();
      setOpen(false);
    } catch (e) {
      setError((e as Error)?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className={styles.acct}>
      {!signedIn ? (
        <button className={styles.acctSignin} type="button" onClick={() => setShowLogin(true)}>
          {t('account.signIn')}
        </button>
      ) : (
        <>
          <button
            className={styles.acctTrigger}
            type="button"
            aria-expanded={open}
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <span className={styles.acctMail}>{account.user?.email}</span>
            <span className={styles.acctPlan}>{t(planKey)}</span>
            <svg className={styles.acctCaret} width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {open && (
            <div className={styles.acctMenu} role="menu">
              <div className={styles.acctHead}>
                <p className={styles.acctEmail}>{account.user?.email}</p>
                <p className={`${styles.acctTier} ${account.error ? styles.acctTierErr : ''}`}>
                  {account.error ? t('account.planUnknown') : t(planKey)}
                </p>
                {account.error ? (
                  <p className={styles.acctErr}>{t('account.statusFailed')}</p>
                ) : hasActiveSub && account.subscription?.current_period_end ? (
                  <p className={styles.acctRenew}>
                    {t('account.renewsOn', {
                      date: new Date(account.subscription.current_period_end).toLocaleDateString(),
                    })}
                  </p>
                ) : null}
              </div>

              {hasActiveSub ? (
                <button
                  className={styles.acctItem}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={onManage}
                >
                  {t('account.manageSub')}
                </button>
              ) : (
                <LocalizedLink to="/pricing" className={styles.acctItem} role="menuitem" onClick={() => setOpen(false)}>
                  {t('account.seePlans')}
                </LocalizedLink>
              )}

              {/* 后台管理：仅管理员可见。用 Link 而非 LocalizedLink —— 后台不带语言前缀。 */}
              {isAdmin && (
                <Link href="/admin" className={styles.acctItem} role="menuitem" onClick={() => setOpen(false)}>
                  {t('account.adminPanel')}
                </Link>
              )}

              <div className={styles.acctSep} />

              <button
                className={`${styles.acctItem} ${styles.acctDanger}`}
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={onSignOut}
              >
                {t('account.signOut')}
              </button>
            </div>
          )}
        </>
      )}

      {showLogin && <AccountDialog onClose={() => setShowLogin(false)} />}
    </div>
  );
}
