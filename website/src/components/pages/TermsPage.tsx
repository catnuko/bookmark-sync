import { makeT, type Locale } from '@/i18n/t';
import { SITE_UPDATED } from '@/lib/site-meta.js';
import styles from './TermsPage.module.css';

const SECTIONS = [
  'service',
  'accounts',
  'plans',
  'refund',
  'acceptable',
  'ip',
  'disclaimer',
  'termination',
  'changes',
  'governing',
  'contact',
];

export default function TermsPage({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <div className={styles.termsPage}>
      <section className={`section ${styles.termsHero}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <p className={`section-eyebrow ${styles.sectionEyebrow}`}>{t('terms.eyebrow')}</p>
          <h1 className={styles.sectionTitle}>{t('terms.title')}</h1>
          <p className={styles.termsUpdated}>
            {t('terms.updatedAtPrefix')} {SITE_UPDATED}
          </p>
          <p className={styles.termsIntro}>{t('terms.intro')}</p>
        </div>
      </section>

      <section className={`section ${styles.termsBody}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <div className={styles.termsSections}>
            {SECTIONS.map((key) => (
              <div key={key} className={styles.termsSection}>
                <h2 className={styles.termsH2}>{t(`terms.sections.${key}.title`)}</h2>
                <p className={styles.termsP}>{t(`terms.sections.${key}.body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
