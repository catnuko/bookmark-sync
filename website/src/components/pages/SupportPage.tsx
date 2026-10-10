import { makeT, type Locale } from '@/i18n/t';
import { SITE } from '@/seo/config';
import LocalizedLink from '@/components/layout/LocalizedLink';
import styles from './SupportPage.module.css';

/**
 * 支持页只留**「要不要 / 会不会 / 安不安全」**这类决策型问题。
 *
 * ★ 去掉 restore / passphrase / accountBar 三条：它们与 /docs 的 FAQ
 *   话题完全相同（换设备恢复、忘口令、账号栏文件夹），措辞不同但问的是一件事。
 *   两页都放 → 用户在任一页都能看到，SEO 上也是同义内容互相稀释。
 *   判据：**一条 FAQ 只在最能回答它的那一页出现**；「怎么操作」归 /docs，
 *   「要不要用它 / 会不会出事」归 /support。
 *
 * 保留 conflict 与 gc：它们问的是「会不会冲突 / 会不会被删」，属于决策判断，
 * 文档页那12 条是「怎么操作」，不冲突。
 */
const FAQ_KEYS = ['account', 'browsers', 'free', 'security', 'conflict', 'gc'];

const RESOURCE_LINKS = [
  { key: 'docs', to: '/docs' },
  { key: 'privacy', to: '/privacy' },
  { key: 'terms', to: '/terms' },
];

export default function SupportPage({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <div className={styles.supportPage}>
      <section className={`section ${styles.supportHero}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <p className={`section-eyebrow ${styles.sectionEyebrow}`}>{t('support.eyebrow')}</p>
          <h1 className={styles.sectionTitle}>{t('support.title')}</h1>
          <p className={styles.supportIntro}>{t('support.intro')}</p>

          <a className={styles.supportEmailCard} href={`mailto:${SITE.email}`}>
            <span className={styles.emailLabel}>{t('support.contact.title')}</span>
            <span className={styles.emailValue}>{SITE.email}</span>
            <span className={styles.emailNote}>{t('support.contact.note')}</span>
          </a>
        </div>
      </section>

      <section className={`section ${styles.supportFaq}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <h2 className={styles.supportH2}>{t('support.faq.title')}</h2>
          <p className={styles.supportSubtitle}>{t('support.faq.subtitle')}</p>

          <div className={styles.faqList}>
            {FAQ_KEYS.map((key) => (
              <details key={key} className={styles.faqItem}>
                <summary className={styles.faqQ}>{t(`support.faq.items.${key}.q`)}</summary>
                <p className={styles.faqA}>{t(`support.faq.items.${key}.a`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className={`section ${styles.supportResources}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <h2 className={styles.supportH2}>{t('support.resources.title')}</h2>
          <p className={styles.supportSubtitle}>{t('support.resources.desc')}</p>
          <div className={styles.resourceLinks}>
            {RESOURCE_LINKS.map((link) => (
              <LocalizedLink key={link.key} to={link.to} className={styles.resourceLink}>
                {t(`support.resources.items.${link.key}`)}
              </LocalizedLink>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
