import { makeT, type Locale } from '@/i18n/t';
import LocalizedLink from '@/components/layout/LocalizedLink';
import { CONTENT_ROUTES, CONTENT_CATEGORIES } from '@/content/manifest';
import { formatDate } from '@/lib/format-date';
import styles from './ContentIndex.module.css';

/**
 * 文章时间线 —— 按发布日期倒序展示全部内容文章。
 *
 * ★ 为什么是「一条时间线」而不是分类分组：
 *   原先按 fix/migrate/explain 分组 + 顶部精选卡，用户反馈「堆在一起很难看」——
 *   多段长度相近的列表没有视觉重心，也没有时间线索。博客式的单一时间线
 *   （日期 + 分类标签 + 标题 + 摘要）更易扫读，新文章自然浮到最上面。
 *
 * ★ 顺序**直接沿用 manifest**：loader 已按 date 倒序生成 CONTENT_ROUTES，
 *   这里只按语言过滤，不再二次排序 —— 两处排序迟早会打架。
 *
 * 日期用 formatDate 纯函数渲染（见 lib/format-date.ts），避免 SSR/CSR 不一致。
 */
export default function ContentIndex({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  const cur: Locale = locale === 'en' ? 'en' : 'zh';

  const items = CONTENT_ROUTES.filter((r) => r.locale === cur).map((r) => ({
    href: `/${r.prefix}/${r.slug}`,
    title: r.title,
    description: r.description,
    date: r.date,
    dateText: formatDate(r.date, cur),
    category: CONTENT_CATEGORIES[r.category as keyof typeof CONTENT_CATEGORIES]?.label?.[cur] || '',
  }));

  return (
    <section className={`section ${styles.contentIndex}`}>
      <div className="container container-narrow">
        <p className={styles.timelineCount}>{t('contentIndex.count', { count: items.length })}</p>
        <ol className={styles.timeline}>
          {items.map((item) => (
            <li key={item.href} className={styles.timelineItem}>
              <time className={styles.timelineDate} dateTime={item.date}>
                {item.dateText}
              </time>
              <div className={styles.timelineMain}>
                {item.category ? <span className={styles.timelineTag}>{item.category}</span> : null}
                <LocalizedLink to={item.href} className={styles.timelineLink}>
                  {item.title}
                </LocalizedLink>
                <p className={styles.timelineDesc}>{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
