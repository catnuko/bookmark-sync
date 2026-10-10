import type { ArticleView } from '@/content/derive';
import { formatDate } from '@/lib/format-date';
import LocalizedLink from '@/components/layout/LocalizedLink';
import ContentBody from '@/components/ContentBody';
import styles from './ContentPage.module.css';

// 内容文章页 —— 由 content/*.md 的解析结果驱动（blocks 是 AST，不是 HTML 字符串）。
//
// ★ 为什么不 dangerouslySetInnerHTML：AST 走组件渲染才能吃到样式，且天然避免
//   XSS（内容是我们自己写的，但仍不给 innerHTML 开口子）。
// ★ Next 静态导出下每篇文章都是预渲染的独立 HTML，数据在构建期由 deriveArticleView
//   装配好直接渲染 —— 不再需要迁移前的「SSG 注入 / CSR fetch」双通道。
export default function ContentPage({ article }: { article: ArticleView }) {
  const cat = article.categoryMeta;
  const fm = article.frontmatter;

  return (
    <article className={styles.contentPage}>
      {/* 页首 */}
      <header className={styles.contentHero}>
        <div className={`container ${styles.containerNarrow}`}>
          <p className="section-eyebrow">{cat.label}</p>
          <h1 className={styles.contentTitle}>{fm.title}</h1>
          {fm.date ? (
            <p className={styles.contentDate}>
              <time dateTime={fm.date}>{formatDate(fm.date, article.locale)}</time>
            </p>
          ) : null}
          <p className={styles.contentLead}>{article.lead}</p>
        </div>
      </header>

      {/* 正文 */}
      <div className={styles.contentBody}>
        <div className={`container ${styles.containerNarrow}`}>
          {/* 目录：内容页普遍 40+ 段落，没有目录很难定位。
              锚点由 parse.js 的 slugOfHeading 生成，与 ContentBody 的 h2 id 一致。 */}
          {article.toc.length >= 3 ? (
            <nav className={styles.contentToc} aria-label="目录">
              <p className={styles.tocTitle}>{cat.tocLabel}</p>
              <ul className={styles.tocList}>
                {article.toc.map((t) => (
                  <li key={t.anchor}>
                    <a href={`#${t.anchor}`} className={styles.tocLink}>
                      {t.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <ContentBody blocks={article.blocks} />

          {/* FAQ：与页面可见问答严格一致（FAQPage JSON-LD 输出同一份数据） */}
          {article.faq.length > 0 ? (
            <section className={styles.contentFaq}>
              <h2 className="content-h2">FAQ</h2>
              {article.faq.map((it) => (
                <details key={it.q} className={styles.contentDetails}>
                  <summary className={styles.contentQ}>{it.q}</summary>
                  <p className={styles.contentA}>{it.a}</p>
                </details>
              ))}
            </section>
          ) : null}

          {/* 相关阅读：同分类的其它文章，构成站内互链 */}
          {article.related.length > 0 ? (
            <section className={styles.contentRelated}>
              <h2 className="content-h2">{cat.relatedLabel}</h2>
              <ul className={styles.relatedList}>
                {article.related.map((r) => (
                  <li key={r.href}>
                    <LocalizedLink to={r.href} className={styles.relatedLink}>
                      {r.title}
                    </LocalizedLink>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* CTA：问题解决页的落点必须是一次转化，而不是又一篇阅读 */}
          <section className={styles.contentCta}>
            <p className={styles.ctaText}>{cat.cta}</p>
            <div className={styles.ctaActions}>
              <LocalizedLink to="/download" className="btn btn-primary btn-lg">
                {cat.ctaLabel}
              </LocalizedLink>
              <LocalizedLink to="/pricing" className="btn btn-outline btn-lg">
                {cat.ctaSecondary}
              </LocalizedLink>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
