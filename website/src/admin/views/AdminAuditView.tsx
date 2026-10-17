'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import DataTable, { type Column } from '../components/DataTable';
import { formatTime, actionLabel, formatAuditDetail } from '../lib/format.js';
import styles from './AdminAuditView.module.css';

type AuditRow = {
  id: string;
  created_at: string;
  admin_email?: string;
  admin_id?: string;
  action: string;
  target_email?: string;
  target_user?: string;
  detail: unknown;
};

const PAGE_SIZE = 50;

const ACTION_OPTIONS = [
  { value: '', label: '全部操作' },
  { value: 'set_plan', label: '改 plan' },
  { value: 'reset_usage', label: '重置用量' },
  { value: 'reset_user_data', label: '清空数据' },
  { value: 'set_gc_threshold', label: '改 GC 阈值' },
  { value: 'request_gc', label: '请求 GC' },
];

export default function AdminAuditView() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.listAuditLogs({
          action: action || null,
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
  }, [page, action]);

  const columns: Column<AuditRow>[] = [
    {
      key: 'time',
      header: '时间',
      className: styles.nowrap,
      cell: (r) => formatTime(r.created_at),
    },
    { key: 'admin', header: '操作人', cell: (r) => r.admin_email || r.admin_id },
    {
      key: 'action',
      header: '操作',
      cell: (r) => <span className={styles.tag}>{actionLabel(r.action)}</span>,
    },
    { key: 'target', header: '目标用户', cell: (r) => r.target_email || r.target_user || '—' },
    {
      key: 'detail',
      header: '变更明细',
      className: styles.detail,
      cell: (r) => formatAuditDetail(r.detail),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <h2>操作审计</h2>
        <select
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
        >
          {ACTION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <p className={styles.muted}>
        后台全部写操作留痕：改 plan / 重置用量 / 清空数据 / GC
        阈值与请求，均记录操作人、时间与改前改后值。
      </p>
      <DataTable
        loading={loading}
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        columns={columns}
        onPageChange={setPage}
        renderCard={(r) => (
          <article className={styles.aCard}>
            <div className={styles.aHead}>
              <span className={styles.tag}>{actionLabel(r.action)}</span>
              <span className={styles.aTime}>{formatTime(r.created_at)}</span>
            </div>
            <div className={styles.aRow}>
              <span className={styles.aK}>操作人</span>
              <span className={styles.aV}>{r.admin_email || r.admin_id}</span>
            </div>
            <div className={styles.aRow}>
              <span className={styles.aK}>目标用户</span>
              <span className={styles.aV}>{r.target_email || r.target_user || '—'}</span>
            </div>
            <div className={styles.aDetail}>{formatAuditDetail(r.detail)}</div>
          </article>
        )}
      />
    </div>
  );
}
