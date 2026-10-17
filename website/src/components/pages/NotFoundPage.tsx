import { makeT, type Locale } from '@/i18n/t';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './NotFoundPage.module.css';

// 404 页：渲染真正的 noindex 页面，而不是 redirect 回首页。
// 软 404（重定向到 '/'）会被 Google 判定为「与首页重复」，拉低全站质量。
const LINKS = [
  { key: 'nav.home', path: '/' },
  { key: 'nav.pricing', path: '/pricing' },
  { key: 'nav.download', path: '/download' },
  { key: 'nav.docs', path: '/docs' },
  { key: 'nav.support', path: '/support' },
];

export default function NotFoundPage({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <div className={styles.nf}>
      <div className={`container ${styles.containerNarrow} ${styles.nfInner}`}>
        <p className={styles.nfCode}>404</p>
        <h1 className={styles.nfTitle}>{t('common.notFound.title')}</h1>
        <p className={styles.nfDesc}>{t('common.notFound.desc')}</p>
        <div className={styles.nfActions}>
          <LocalizedLink to="/" className="btn btn-primary">
            {t('common.backToHome')}
          </LocalizedLink>
        </div>
        <nav className={styles.nfLinks} aria-label={t('common.notFound.title')}>
          {LINKS.map((l) => (
            <LocalizedLink key={l.key} to={l.path} className={styles.nfLink}>
              {t(l.key)}
            </LocalizedLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
