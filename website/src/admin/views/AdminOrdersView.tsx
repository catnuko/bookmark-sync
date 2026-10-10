'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { formatTime, formatMoney, orderStatusMeta } from '../lib/format.js';
import styles from './AdminOrdersView.module.css';

type OrderRow = {
  id: string;
  created_at: string;
  email?: string;
  plan: string;
  amount_cents: number | null;
  currency: string;
  status: string;
  creem_order_id?: string;
};

const PAGE_SIZE = 50;

export default function AdminOrdersView() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.listOrders({
          status: status || null,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });
        if (alive) {
          setRows(res.rows || []);
          setTotal(res.total || 0);
        }
      } catch (e) {
        alert((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, status]);

  const columns: Column<OrderRow>[] = [
    { key: 'time', header: '时间', cell: (r) => formatTime(r.created_at) },
    { key: 'email', header: '邮箱', cell: (r) => r.email || '—' },
    { key: 'plan', header: 'plan', cell: (r) => r.plan },
    { key: 'amount', header: '金额', cell: (r) => formatMoney(r.amount_cents, r.currency) },
    {
      key: 'status',
      header: '状态',
      cell: (r) => {
        const m = orderStatusMeta(r.status);
        return <StatusBadge label={m.label} tone={m.tone} />;
      },
    },
    {
      key: 'creem',
      header: 'Creem Order ID',
      className: styles.mono,
      cell: (r) => r.creem_order_id || '—',
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <h2>订单</h2>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">全部状态</option>
          <option value="paid">已支付</option>
          <option value="pending">待支付</option>
          <option value="refunded">已退款</option>
          <option value="failed">失败</option>
        </select>
      </div>
      <DataTable
        loading={loading}
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        columns={columns}
        onPageChange={setPage}
        renderCard={(r) => {
          const m = orderStatusMeta(r.status);
          return (
            <article className={styles.oCard}>
              <div className={styles.oHead}>
                <span className={styles.oAmount}>{formatMoney(r.amount_cents, r.currency)}</span>
                <StatusBadge label={m.label} tone={m.tone} />
              </div>
              <div className={styles.oRow}>
                <span className={styles.oK}>时间</span>
                <span className={styles.oV}>{formatTime(r.created_at)}</span>
              </div>
              <div className={styles.oRow}>
                <span className={styles.oK}>邮箱</span>
                <span className={styles.oV}>{r.email || '—'}</span>
              </div>
              <div className={styles.oRow}>
                <span className={styles.oK}>plan</span>
                <span className={styles.oV}>{r.plan}</span>
              </div>
              <div className={styles.oRow}>
                <span className={styles.oK}>Creem Order ID</span>
                <span className={`${styles.oV} ${styles.mono}`}>{r.creem_order_id || '—'}</span>
              </div>
            </article>
          );
        }}
      />
    </div>
  );
}
