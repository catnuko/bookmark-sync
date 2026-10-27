import { makeT, type Locale } from '@/i18n/t';
import LocalizedLink from './LocalizedLink';
import styles from './AppFooter.module.css';

// ★ 「功能」原先指向 /#features（首页 FeatureSection 的锚点）。该区块 2026-10 已删除，
//   锚点随之消失 —— 指向 /#compare 会更好：对比矩阵现在承担了「我们有什么能力」这件事，
//   而且它是首页上唯一能被外部直接引用的能力说明。
const PRODUCT_LINKS = [
  { label: 'nav.features', to: '/#compare' },
  { label: 'nav.pricing', to: '/pricing' },
  { label: 'nav.download', to: '/download' },
];

const RESOURCE_LINKS = [
  { label: 'nav.docs', to: '/docs' },
  { label: 'nav.support', to: '/support' },
];

const LEGAL_LINKS = [
  { label: 'nav.privacy', to: '/privacy' },
  { label: 'nav.terms', to: '/terms' },
];

export default function AppFooter({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  const email = t('contact.supportEmail');

  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.footerInner}`}>
        <div className={styles.footerBrand}>
          <LocalizedLink to="/" className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/favicon.svg" alt="BookmarkSync" width={28} height={28} />
            <span className={styles.brandName}>{t('brand.name')}</span>
          </LocalizedLink>
          <p className={styles.footerTagline}>{t('footer.tagline')}</p>
        </div>

        <div className={styles.footerCols}>
          <div className={styles.footerCol}>
            <h4 className={styles.footerTitle}>{t('footer.product')}</h4>
            {PRODUCT_LINKS.map((link) => (
              <LocalizedLink key={link.label} to={link.to} className={styles.footerLink}>
                {t(link.label)}
              </LocalizedLink>
            ))}
          </div>

          <div className={styles.footerCol}>
            <h4 className={styles.footerTitle}>{t('footer.resources')}</h4>
            {RESOURCE_LINKS.map((link) => (
              <LocalizedLink key={link.label} to={link.to} className={styles.footerLink}>
                {t(link.label)}
              </LocalizedLink>
            ))}
          </div>
        </div>
      </div>

      <div className={`container ${styles.footerBottom}`}>
        <div className={styles.footerBottomLeft}>
          <p className={styles.copyright}>{t('footer.copyright')}</p>
          <nav className={styles.legalLinks} aria-label="Legal">
            {LEGAL_LINKS.map((link) => (
              <LocalizedLink key={link.label} to={link.to} className={styles.legalLink}>
                {t(link.label)}
              </LocalizedLink>
            ))}
          </nav>
        </div>
        <a href={`mailto:${email}`} className={styles.footerSupport}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <rect
              x="3"
              y="5"
              width="18"
              height="14"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M3 7l9 6 9-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{email}</span>
        </a>
      </div>
    </footer>
  );
}
