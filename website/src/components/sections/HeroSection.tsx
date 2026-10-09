import { makeT, type Locale } from '@/i18n/t';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './HeroSection.module.css';

export default function HeroSection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section className={styles.hero}>
      {/* 背景装饰：细网格 + 渐变光晕 */}
      <div className={styles.heroBg} aria-hidden="true">
        <div className={styles.heroGrid} />
        <div className={styles.heroGlow} />
      </div>

      <div className={`container ${styles.heroInner}`}>
        <span className={`badge badge-accent ${styles.heroBadge}`}>
          <span className={styles.badgeDot} />
          {t('hero.badge')}
        </span>

        <h1 className={styles.heroTitle}>{t('hero.title')}</h1>

        <p className={styles.heroSubtitle}>{t('hero.subtitle')}</p>

        <div className={styles.heroCta}>
          <LocalizedLink to="/download" className="btn btn-primary btn-lg">
            {t('hero.ctaPrimary')}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </LocalizedLink>
          <LocalizedLink to="/pricing" className="btn btn-outline btn-lg">
            {t('hero.ctaSecondary')}
          </LocalizedLink>
        </div>

        <p className={styles.heroTrust}>{t('hero.trustBadge')}</p>

        {/* 产品预览：模拟浏览器书签面板 */}
        <div className={styles.heroPreview}>
          <div className={styles.previewFrame}>
            <div className={styles.previewBar}>
              <span className={`${styles.dot} ${styles.dotRed}`} />
              <span className={`${styles.dot} ${styles.dotYellow}`} />
              <span className={`${styles.dot} ${styles.dotGreen}`} />
              <div className={styles.previewAddr}>bookmarks</div>
            </div>
            <div className={styles.previewBody}>
              <div className={styles.previewFolder}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                </svg>
                <span>{t('hero.previewFolder1')}</span>
                <svg className={styles.syncSpin} width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 4v6h6M20 20v-6h-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M20 10a8 8 0 00-15-2M4 14a8 8 0 0015 2"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className={styles.previewBookmark}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 4v16l7-5 7 5V4z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>GitHub · github.com</span>
              </div>
              <div className={styles.previewBookmark}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 4v16l7-5 7 5V4z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>MDN Web Docs</span>
              </div>
              <div className={styles.previewFolder}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                </svg>
                <span>{t('hero.previewFolder2')}</span>
              </div>
              <div className={styles.previewBookmark}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 4v16l7-5 7 5V4z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Figma · figma.com</span>
              </div>
              <div className={`${styles.previewBookmark} ${styles.previewDeleted}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 4v16l7-5 7 5V4z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{t('hero.previewDeleted')}</span>
                <svg className={styles.restoreIcon} width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
