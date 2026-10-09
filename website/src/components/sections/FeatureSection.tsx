import { makeT, type Locale } from '@/i18n/t';
import styles from './FeatureSection.module.css';

const FEATURES = [
  { key: 'sync' },
  { key: 'spaces' },
  { key: 'devices' },
  { key: 'history' },
  { key: 'order' },
  { key: 'quota' },
  { key: 'privacy' },
  { key: 'conflict' },
  { key: 'migration' },
] as const;

const ICON_PATHS: Record<string, string> = {
  sync: 'M21 12a9 9 0 11-9-9 9 9 0 019 9zM12 7v5l3 3',
  spaces: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  devices: 'M3 5h14a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zM9 19h4M11 14v5',
  history: 'M3 12a9 9 0 109-9 9 9 0 00-9 9zM3 12h5l2-2 2 4 2-2h7',
  order: 'M8 20V6M8 6L5 9M8 6l3 3M16 4v14M16 18l-3-3M16 18l3-3',
  quota: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8M9 12h6',
  privacy: 'M12 2L4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6l-8-4zM12 8v4M12 16h.01',
  conflict: 'M7 7h10M7 12h10M7 17h6M3 7v10M21 7v10',
  migration: 'M5 12h14M13 6l6 6-6 6',
};

export default function FeatureSection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section id="features" className={`section ${styles.sectionFeatures}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('features.eyebrow')}</p>
          <h2 className="section-title">{t('features.title')}</h2>
          <p className="section-subtitle">{t('features.subtitle')}</p>
        </div>

        <div className={styles.featuresGrid}>
          {FEATURES.map((feature) => (
            <div key={feature.key} className={styles.featureCard}>
              <div className={styles.featureIcon}>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={ICON_PATHS[feature.key]} />
                </svg>
              </div>
              <h3 className={styles.featureTitle}>{t(`features.items.${feature.key}.title`)}</h3>
              <p className={styles.featureDesc}>{t(`features.items.${feature.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
