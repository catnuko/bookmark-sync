'use client';

import { useState } from 'react';
import { useLocale } from '@/i18n/LocaleProvider';
import { account, startCheckout, openPortal, hasActiveSubscription } from '@/lib/account.js';
import { useAccount } from '@/lib/useAccount';
import AccountDialog from '@/components/layout/AccountDialog';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './PricingCard.module.css';

export type PlanKey = 'free' | 'plus' | 'pro';

export default function PricingCard({
  plan,
  highlighted = false,
}: {
  plan: PlanKey;
  highlighted?: boolean;
}) {
  const { t, tm } = useLocale();
  useAccount();

  // 动态取该档位的特性列表，全部渲染（不再截断）
  const raw = tm(`pricing.plans.${plan}.features`);
  const features: string[] = Array.isArray(raw) ? (raw as string[]) : [];

  // 付费档 CTA：
  //   未登录 => 弹登录；当前档位订阅有效 => 打开 Creem 门户管理/取消；否则发起订阅。
  const [busy, setBusy] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [error, setError] = useState('');

  const isPaid = plan !== 'free';
  const isCurrentPlan = hasActiveSubscription() && account.subscription?.plan === plan;

  // 账户状态拉取失败（RLS/网络）时 account.plan 是 null 而非 'free'。
  // 此时**不能**显示「订阅 Pro」——付费用户会以为没买过、再付一次钱。
  // 改成禁用 + 提示，让用户刷新重试。
  const statusUnknown = !!account.user && !!account.error;

  async function onPaidCta() {
    if (busy || statusUnknown) return;
    setError('');
    if (!account.user) {
      setShowLogin(true);
      return;
    }
    if (isCurrentPlan) {
      setBusy(true);
      try {
        const url = await openPortal();
        window.open(url, '_blank', 'noopener');
      } catch (e) {
        setError((e as Error)?.message || t('account.portalFailed'));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const url = await startCheckout(plan);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError((e as Error)?.message || t('account.checkoutFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.planCard} ${highlighted ? styles.planHighlight : ''}`}>
      {highlighted ? <div className={styles.planBadge}>{t('pricing.popular')}</div> : null}

      <div className={styles.planHead}>
        <h3 className={styles.planName}>{t(`pricing.plans.${plan}.name`)}</h3>
        <p className={styles.planDesc}>{t(`pricing.plans.${plan}.desc`)}</p>
      </div>

      <div className={styles.planPriceRow}>
        <span className={styles.planPrice}>{t(`pricing.plans.${plan}.price`)}</span>
        <span className={styles.planUnit}>{t(`pricing.plans.${plan}.unit`)}</span>
      </div>

      {/* 免费档：引导装扩展；付费档：登录后直接在官网订阅 / 管理订阅 */}
      {!isPaid ? (
        <LocalizedLink to="/download" className={`btn ${styles.planCta} btn-outline`}>
          {t(`pricing.plans.${plan}.cta`)}
        </LocalizedLink>
      ) : (
        <>
          <button
            className={`btn ${styles.planCta} ${highlighted ? 'btn-primary' : 'btn-outline'}`}
            disabled={busy || statusUnknown}
            onClick={onPaidCta}
          >
            {busy
              ? t('account.processing')
              : statusUnknown
                ? t('account.statusUnknownShort')
                : isCurrentPlan
                  ? t('account.manageSub')
                  : t(`pricing.plans.${plan}.cta`)}
          </button>
          {statusUnknown ? (
            <p className={styles.planCtaError}>{t('account.statusFailed')}</p>
          ) : null}
          {isCurrentPlan && account.subscription?.current_period_end ? (
            <p className={styles.planSubStatus}>
              {t('account.renewsOn', {
                date: new Date(account.subscription.current_period_end).toLocaleDateString(),
              })}
            </p>
          ) : null}
          {error ? <p className={styles.planCtaError}>{error}</p> : null}
        </>
      )}

      {showLogin ? <AccountDialog onClose={() => setShowLogin(false)} /> : null}

      <ul className={styles.planFeatures}>
        {features.map((feature, i) => (
          <li key={i} className={styles.planFeature}>
            <svg className={styles.check} width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
