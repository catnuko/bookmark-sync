import { makeT, type Locale } from '@/i18n/t';
import styles from './OpenSourceSection.module.css';

const REPO_URL = 'https://github.com/catnuko/bookmark-sync';
const SELF_HOSTING_URL =
  'https://github.com/catnuko/bookmark-sync/blob/main/docs/SELF-HOSTING.md';

export default function OpenSourceSection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section className={`section ${styles.openSourceSection}`}>
      <div className="container">
        <div className={`card ${styles.openSourceCard}`}>
          <span className={`section-eyebrow ${styles.eyebrow}`}>{t('opensource.eyebrow')}</span>
          <h2 className="section-title">{t('opensource.title')}</h2>
          <p className={`section-subtitle ${styles.subtitle}`}>{t('opensource.subtitle')}</p>
          <div className={styles.actions}>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              className="btn btn-primary btn-lg"
            >
              {t('opensource.repoCta')}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M7 17L17 7M17 7H8M17 7v9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <a
              href={SELF_HOSTING_URL}
              target="_blank"
              rel="noopener"
              className="btn btn-outline btn-lg"
            >
              {t('opensource.selfHostCta')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
