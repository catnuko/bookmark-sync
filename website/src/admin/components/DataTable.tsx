'use client';

import { Fragment, type ReactNode } from 'react';
import styles from './DataTable.module.css';

export type Column<T> = {
  key: string;
  header?: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  className?: string;
};

type Props<T> = {
  loading?: boolean;
  rows: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  emptyText?: string;
  columns: Column<T>[];
  renderCard?: (row: T, index: number) => ReactNode;
  onPageChange?: (page: number) => void;
  rowKey?: (row: T, index: number) => string | number;
};

export default function DataTable<T>({
  loading = false,
  rows,
  total = 0,
  page = 1,
  pageSize = 50,
  emptyText = '暂无数据',
  columns,
  renderCard,
  onPageChange,
  rowKey,
}: Props<T>) {
  const hasCards = !!renderCard;
  const keyOf = (row: T, i: number) =>
    rowKey
      ? rowKey(row, i)
      : ((row as { id?: string; user_id?: string }).id ??
        (row as { user_id?: string }).user_id ??
        i);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={`${styles.tableWrap} ${hasCards ? styles.hasCards : ''}`}>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.className}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={99} className={`${styles.cell} ${styles.muted}`}>
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={99} className={`${styles.cell} ${styles.muted}`}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={keyOf(row, i)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.className}>
                      {c.cell(row, i)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasCards ? (
        <div className={styles.cards}>
          {loading ? (
            <p className={styles.cardsMsg}>加载中…</p>
          ) : rows.length === 0 ? (
            <p className={styles.cardsMsg}>{emptyText}</p>
          ) : (
            rows.map((row, i) => <Fragment key={keyOf(row, i)}>{renderCard!(row, i)}</Fragment>)
          )}
        </div>
      ) : null}

      {total > pageSize ? (
        <div className={styles.pager}>
          <button type="button" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
            上一页
          </button>
          <span>
            第 {page} 页 / 共 {pageCount} 页（{total} 条）
          </span>
          <button
            type="button"
            disabled={page * pageSize >= total}
            onClick={() => onPageChange?.(page + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  );
}
