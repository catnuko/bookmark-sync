import { makeT, type Locale } from '@/i18n/t';
import LocalizedLink from '@/components/layout/LocalizedLink';
import {
  COMPARE_DETAIL_PATH,
  COMPARE_PRODUCTS,
  COMPARE_ROWS,
  type CompareValue,
  type I18nText,
} from '@/lib/compare';
import styles from './CompareSection.module.css';

/**
 * 首页对比矩阵 —— 一张表回答「它和我正在用的那个有什么不一样」。
 *
 * ★ 为什么首页要放：访客到首页时心里往往已经有一两个候选（Floccus / Raindrop /
 *   浏览器自带同步）。不给对照，他们就得自己去搜——那一步通常就流失了。
 * ★ 为什么只放**结论**、详情去文章：表格能扫，理由不能塞进单元格。所以每格最多
 *   一句短语，完整的「为什么」放在 /explain/bookmark-sync-vs-alternatives。
 * ★ 数据在 lib/compare.ts（唯一来源），本组件只管渲染。
 * ★ 无障碍：纯图标单元格必须带可读文本（<span class=visuallyHidden>），
 *   否则读屏软件念出来的是一串空白。
 */

/** 图标 → 读屏文本（纯图标单元格不能是空白）。 */
const KIND_LABEL = {
  yes: 'compare.legend.yes',
  partial: 'compare.legend.partial',
  no: 'compare.legend.no',
  na: 'compare.legend.na',
} as const;

const KIND_ICON = { yes: '✓', partial: '△', no: '—', na: '/' } as const;

const KIND_CLASS = {
  yes: styles.cellYes,
  partial: styles.cellPartial,
  no: styles.cellNo,
  na: styles.cellNa,
} as const;

const pick = (v: I18nText, locale: Locale) => v[locale];

function CellValue({ value, locale }: { value: CompareValue; locale: Locale }) {
  if (value.kind === 'text')
    return <span className={styles.cellText}>{pick(value.text, locale)}</span>;

  const t = makeT(locale);
  return (
    <span className={`${styles.cellMark} ${KIND_CLASS[value.kind]}`}>
      <span aria-hidden="true">{KIND_ICON[value.kind]}</span>
      <span className={styles.visuallyHidden}>{t(KIND_LABEL[value.kind])}</span>
      {value.note ? <span className={styles.cellNote}>{pick(value.note, locale)}</span> : null}
    </span>
  );
}

export default function CompareSection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  const labelOf = (v: I18nText) => v[locale];

  return (
    <section id="compare" className={`section ${styles.sectionCompare}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('compare.eyebrow')}</p>
          <h2 className="section-title">{t('compare.title')}</h2>
          <p className="section-subtitle">{t('compare.subtitle')}</p>
        </div>

        {/* 窄屏提示：表格可横向滚动，否则用户只会看到被裁掉的右半边 */}
        <p className={styles.scrollHint}>{t('compare.scrollHint')}</p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>{t('compare.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" className={styles.colFeature}>
                  {t('compare.colFeature')}
                </th>
                {COMPARE_PRODUCTS.map((p) => (
                  <th key={p.key} scope="col" className={p.self ? styles.colSelf : undefined}>
                    <span className={styles.productName}>{p.name}</span>
                    <span className={styles.productTagline}>{labelOf(p.tagline)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label.en}>
                  <th scope="row" className={styles.colFeature}>
                    {labelOf(row.label)}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={COMPARE_PRODUCTS[i].key}
                      className={COMPARE_PRODUCTS[i].self ? styles.colSelf : undefined}
                    >
                      <CellValue value={cell} locale={locale} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.footnote}>
          <p className={styles.legend}>
            <span className={`${styles.cellMark} ${styles.cellYes}`} aria-hidden="true">
              ✓
            </span>
            {t('compare.legend.yes')}
            <span className={styles.legendSep} aria-hidden="true">
              ·
            </span>
            <span className={`${styles.cellMark} ${styles.cellPartial}`} aria-hidden="true">
              △
            </span>
            {t('compare.legend.partial')}
            <span className={styles.legendSep} aria-hidden="true">
              ·
            </span>
            <span className={`${styles.cellMark} ${styles.cellNo}`} aria-hidden="true">
              —
            </span>
            {t('compare.legend.no')}
            <span className={styles.legendSep} aria-hidden="true">
              ·
            </span>
            <span className={`${styles.cellMark} ${styles.cellNa}`} aria-hidden="true">
              /
            </span>
            {t('compare.legend.na')}
          </p>

          <div className={styles.actions}>
            <LocalizedLink to={COMPARE_DETAIL_PATH} className="btn btn-outline">
              {t('compare.cta')}
            </LocalizedLink>
            <p className={styles.disclaimer}>{t('compare.disclaimer')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
