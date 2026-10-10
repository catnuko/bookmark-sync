import { makeT, type Locale } from '@/i18n/t';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './CTASection.module.css';

export default function CTASection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section className={`section ${styles.ctaSection}`}>
      <div className="container">
        <div className={styles.ctaCard}>
          <div className={styles.ctaGridBg} aria-hidden="true" />
          <h2 className={styles.ctaTitle}>{t('hero.title')}</h2>
          <p className={styles.ctaSubtitle}>{t('hero.subtitle')}</p>
          <div className={styles.ctaActions}>
            <LocalizedLink to="/download" className="btn btn-primary btn-lg">
              {t('hero.ctaPrimary')}
            </LocalizedLink>
            <LocalizedLink to="/pricing" className={`btn btn-outline btn-lg ${styles.ctaOutline}`}>
              {t('hero.ctaSecondary')}
            </LocalizedLink>
          </div>
        </div>
      </div>
    </section>
  );
}
