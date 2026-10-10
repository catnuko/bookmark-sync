import { makeT, type Locale } from '@/i18n/t';
import PricingCard from '@/components/pricing/PricingCard';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './PricingPreview.module.css';

const PLANS = [
  { plan: 'free', highlighted: false },
  { plan: 'plus', highlighted: true },
  { plan: 'pro', highlighted: false },
] as const;

export default function PricingPreview({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section id="pricing" className={`section ${styles.sectionPricingPreview}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('pricing.eyebrow')}</p>
          <h2 className="section-title">{t('pricing.title')}</h2>
          <p className="section-subtitle">{t('pricing.subtitle')}</p>
        </div>

        <div className={styles.plansGrid}>
          {PLANS.map((p) => (
            <PricingCard key={p.plan} plan={p.plan} highlighted={p.highlighted} />
          ))}
        </div>

        <div className={styles.pricingMore}>
          <LocalizedLink to="/pricing" className="link">
            {t('common.viewAll')}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              style={{ marginLeft: 4, verticalAlign: -2 }}
            >
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </LocalizedLink>
        </div>
      </div>
    </section>
  );
}
