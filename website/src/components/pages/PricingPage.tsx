import { makeT, makeTm, type Locale } from '@/i18n/t';
import PricingCard, { type PlanKey } from '@/components/pricing/PricingCard';
import FAQSection from '@/components/sections/FAQSection';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './PricingPage.module.css';

const PLANS: { plan: PlanKey; highlighted: boolean }[] = [
  { plan: 'free', highlighted: false },
  { plan: 'plus', highlighted: true },
  { plan: 'pro', highlighted: false },
];

type CompareRow = { feature: string; free: unknown; plus: unknown; pro: unknown };

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function cellValue(v: unknown): 'yes' | 'no' | 'text' {
  if (isBool(v)) return v ? 'yes' : 'no';
  return 'text';
}

function CompareCell({ value }: { value: unknown }) {
  const kind = cellValue(value);
  if (kind === 'yes') return <span className={styles.cellYes}>✓</span>;
  if (kind === 'no') return <span className={styles.cellNo}>—</span>;
  return <span className={styles.cellText}>{String(value)}</span>;
}

export default function PricingPage({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  const tm = makeTm(locale);

  // 解析 i18n 对比表行，把 boolean / string 都还原成可渲染格式
  const rawRows = tm('pricing.compare.rows');
  const compareRows = (Array.isArray(rawRows) ? rawRows : []) as CompareRow[];

  return (
    <div className={styles.pricingPage}>
      <section className={`section ${styles.pricingHero}`}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <p className="section-eyebrow">{t('pricing.eyebrow')}</p>
            <h1 className="section-title">{t('pricing.title')}</h1>
            <p className="section-subtitle">{t('pricing.subtitle')}</p>
          </div>

          <div className={styles.plansGrid}>
            {PLANS.map((p) => (
              <PricingCard key={p.plan} plan={p.plan} highlighted={p.highlighted} />
            ))}
          </div>
        </div>
      </section>

      {/* 完整功能对比表 */}
      <section className={`section ${styles.compareSection}`}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <h2 className="section-title">{t('pricing.compare.title')}</h2>
          </div>

          <div className={styles.compareTableWrap}>
            <table className={styles.compareTable}>
              <thead>
                <tr>
                  <th className={styles.colFeature}>{t('pricing.compare.colFeature')}</th>
                  <th>{t('pricing.compare.colFree')}</th>
                  <th className={styles.colHighlight}>{t('pricing.compare.colPlus')}</th>
                  <th>{t('pricing.compare.colPro')}</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row, i) => (
                  <tr key={i}>
                    <td className={styles.colFeature}>{row.feature}</td>
                    <td>
                      <CompareCell value={row.free} />
                    </td>
                    <td className={styles.colHighlight}>
                      <CompareCell value={row.plus} />
                    </td>
                    <td>
                      <CompareCell value={row.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.pricingLegalNote}>
            {t('pricing.legalNote')}{' '}
            <LocalizedLink to="/terms" className="link">
              {t('nav.terms')}
            </LocalizedLink>{' '}
            ·{' '}
            <LocalizedLink to="/privacy" className="link">
              {t('nav.privacy')}
            </LocalizedLink>
          </p>
        </div>
      </section>

      <FAQSection />
    </div>
  );
}
