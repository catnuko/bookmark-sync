import { makeT, type Locale } from '@/i18n/t';
import ContentIndex from '@/components/ContentIndex';
import styles from './DocsPage.module.css';

/**
 * 文章页（/docs）—— 只保留文章：一条按发布时间倒序的时间线。
 *
 * ★ 历史包袱已移除：这里原先是 i18n 硬编码的「快速开始 / 功能详解 / 常见问题 /
 *   故障排查」四段，与下方的文章列表叠在一起，信息形态杂、也没有时间线索。
 *   现在那四段内容全部改写成了 markdown 文章（guide 分类），本页只负责标题
 *   与列表 —— 内容一律走内容管线，改文章不用改组件。
 */
export default function DocsPage({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <div className={styles.docsPage}>
      <section className={`section ${styles.docsHero}`}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <p className="section-eyebrow">{t('docs.eyebrow')}</p>
            <h1 className="section-title">{t('docs.title')}</h1>
            <p className="section-subtitle">{t('docs.subtitle')}</p>
          </div>
        </div>
      </section>

      <ContentIndex locale={locale} />
    </div>
  );
}
