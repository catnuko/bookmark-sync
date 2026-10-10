import { makeT, type Locale } from '@/i18n/t';
import styles from './PainSection.module.css';

const PAINS = [
  { key: 'lost', icon: 'lost' },
  { key: 'crossBrowser', icon: 'browser' },
  { key: 'migration', icon: 'device' },
  { key: 'history', icon: 'history' },
  { key: 'mixed', icon: 'mixed' },
  { key: 'lock', icon: 'lock' },
] as const;

const ICONS: Record<string, string> = {
  lost: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  browser: 'M3 9h18M9 21V9M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z',
  device:
    'M9 7H5a2 2 0 00-2 2v8a2 2 0 002 2h4M9 7V3a2 2 0 012-2h6a2 2 0 012 2v18a2 2 0 01-2 2h-6a2 2 0 01-2-2V7z',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8m0-5v5h5M12 7v5l4 2',
  mixed: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  lock: 'M12 17v-3m0-8V4a1 1 0 00-1-1H9a1 1 0 00-1 1v2M7 8h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2z',
};

export default function PainSection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section id="pain" className={`section ${styles.sectionPain}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('pain.eyebrow')}</p>
          <h2 className="section-title">{t('pain.title')}</h2>
          <p className="section-subtitle">{t('pain.subtitle')}</p>
        </div>

        <div className={styles.painGrid}>
          {PAINS.map((pain) => (
            <div key={pain.key} className={`card card-hover ${styles.painCard}`}>
              <div className={styles.painIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={ICONS[pain.icon]} />
                </svg>
              </div>
              <h3 className={styles.painTitle}>{t(`pain.items.${pain.key}.title`)}</h3>
              <p className={styles.painDesc}>{t(`pain.items.${pain.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
