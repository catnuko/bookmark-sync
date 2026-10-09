import { slugOfHeading as slugOf } from '@/content/parse.js';
import type { Block, InlineNode, TableCell } from '@/content/types';
import styles from './ContentBody.module.css';

// AST → DOM。只渲染解析器会产出的类型，遇到未知类型显式报错（不静默忽略，
// 那会让「作者写了段新语法但没渲染出来」这类问题变成看不见的内容缺失）。
//
// ★ 行内 inline 数组是 [{type:'text'|'strong'|'code', value}]，用 map 渲染，
//   不用 dangerouslySetInnerHTML —— 保持样式类生效，同时不给 innerHTML 开口子。
function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.type === 'text' ? (
          <a key={i}>{n.value}</a>
        ) : (
          <a key={i} className={n.type === 'strong' ? styles.strong : styles.code}>
            {n.value}
          </a>
        ),
      )}
    </>
  );
}

function Heading({ level, text, inline }: { level: 2 | 3 | 4; text: string; inline: InlineNode[] }) {
  const cls = level === 2 ? styles.h2 : level === 3 ? styles.h3 : styles.h4;
  const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
  return (
    <Tag id={slugOf(text)} className={cls}>
      <Inline nodes={inline} />
    </Tag>
  );
}

export default function ContentBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className={styles.cb}>
      {blocks.map((b, i) => {
        if (b.type === 'heading') return <Heading key={i} level={b.level} text={b.text} inline={b.inline} />;

        if (b.type === 'paragraph')
          return (
            <p key={i} className={styles.p}>
              <Inline nodes={b.inline} />
            </p>
          );

        if (b.type === 'quote')
          return (
            <blockquote key={i} className={styles.quote}>
              <Inline nodes={b.inline} />
            </blockquote>
          );

        if (b.type === 'list') {
          const items = b.items.map((it, k) => (
            <li key={k} className={styles.li}>
              <Inline nodes={it.inline} />
            </li>
          ));
          return b.ordered ? (
            <ol key={i} className={styles.ol}>
              {items}
            </ol>
          ) : (
            <ul key={i} className={styles.ul}>
              {items}
            </ul>
          );
        }

        if (b.type === 'code')
          return (
            <pre key={i} className={styles.pre}>
              <code>{b.value}</code>
            </pre>
          );

        if (b.type === 'image')
          return (
            <figure key={i} className={styles.figure}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.img} src={b.src} alt={b.alt} loading="lazy" decoding="async" />
              {b.alt ? <figcaption className={styles.figcap}>{b.alt}</figcaption> : null}
            </figure>
          );

        if (b.type === 'table') {
          const cell = (c: TableCell, k: number) => (
            <td key={k}>
              <Inline nodes={c.inline} />
            </td>
          );
          return (
            <div key={i} className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {b.header.map((h, k) => (
                      <th key={k}>
                        <Inline nodes={h.inline} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, k) => (
                    <tr key={k}>{row.map(cell)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={i} className={styles.unknown}>
            [未支持的内容类型：{(b as { type: string }).type}]
          </p>
        );
      })}
    </div>
  );
}
