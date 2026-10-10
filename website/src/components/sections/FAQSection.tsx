'use client';

import { useState } from 'react';
import { useLocale } from '@/i18n/LocaleProvider';
import styles from './FAQSection.module.css';

/**
 * 定价页只保留**价格与账号**相关的问题。
 *
 * ★ 为什么不全放（曾经这里是 12 条，首页也在用同一份）：
 *   - 「忘记口令」「换设备恢复」「能不能关自动同步」「配额按字节」这类是
 *     **操作/机制**问题，用户是在文档页或排障时才问的，混在价格页里是噪音；
 *   - 而且它们本来就会在 docs 与 support 各出现一次，三处重复会让每页都
 *     有几条不相关的问答。
 *   判据：**一条 FAQ 只在最能回答它的那一页出现。**
 *
 * 有疑问的读者走 /docs 或 /support，那里是它们的归属地。
 */
const FAQ_KEYS = ['upgrade', 'refund', 'freeLimit', 'payment', 'subOrOnetime', 'quotaUnit'];

export default function FAQSection() {
  const { t } = useLocale();
  const [openIndex, setOpenIndex] = useState(0);

  function toggle(i: number) {
    setOpenIndex((cur) => (cur === i ? -1 : i));
  }

  return (
    <section className={`section ${styles.sectionFaq}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('pricing.eyebrow')}</p>
          <h2 className="section-title">{t('pricing.faq.title')}</h2>
        </div>

        <div className={styles.faqList}>
          {FAQ_KEYS.map((key, i) => (
            <div key={key} className={`${styles.faqItem} ${openIndex === i ? styles.open : ''}`}>
              <button className={styles.faqQ} onClick={() => toggle(i)}>
                <span>{t(`pricing.faq.items.${key}.q`)}</span>
                <svg
                  className={styles.faqArrow}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <div className={styles.faqAWrap}>
                <p className={styles.faqA}>{t(`pricing.faq.items.${key}.a`)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
