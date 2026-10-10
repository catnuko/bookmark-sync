import { makeT, type Locale } from '@/i18n/t';
import { SITE_UPDATED } from '@/lib/site-meta.js';
import styles from './PrivacyPage.module.css';

const SECTIONS = ['collect', 'store', 'use', 'share', 'delete', 'contact'];

export default function PrivacyPage({ locale }: { locale: Locale }) {
  const t = makeT(locale);

  // contact 小节把邮箱包裹成可点击 mailto 链接
  const email = t('contact.supportEmail');
  const contactBody = t('privacy.sections.contact.body').replace(
    email,
    `<a href="mailto:${email}" class="${styles.privacyEmail}">${email}</a>`,
  );

  return (
    <div className={styles.privacyPage}>
      <section className={`section ${styles.privacyHero}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <p className={`section-eyebrow ${styles.sectionEyebrow}`}>{t('privacy.eyebrow')}</p>
          <h1 className={styles.sectionTitle}>{t('privacy.title')}</h1>
          <p className={styles.privacyUpdated}>
            {t('privacy.updatedAtPrefix')} {SITE_UPDATED}
          </p>
          <p className={styles.privacyIntro}>{t('privacy.intro')}</p>
        </div>
      </section>

      <section className={`section ${styles.privacyBody}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <div className={styles.privacySections}>
            {SECTIONS.map((key) => (
              <div key={key} className={styles.privacySection}>
                <h2 className={styles.privacyH2}>{t(`privacy.sections.${key}.title`)}</h2>
                {key === 'contact' ? (
                  <p
                    className={styles.privacyP}
                    dangerouslySetInnerHTML={{ __html: contactBody }}
                  />
                ) : (
                  <p className={styles.privacyP}>{t(`privacy.sections.${key}.body`)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
