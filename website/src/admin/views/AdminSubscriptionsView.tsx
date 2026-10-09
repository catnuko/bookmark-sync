'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import StatusBadge from '../components/StatusBadge';
import { formatTime, subStatusMeta } from '../lib/format.js';
import styles from './AdminSubscriptionsView.module.css';

type SubRow = {
  user_id: string;
  email?: string;
  plan: string;
  status: string;
  current_period_end: string | null;
  canceled_at: string | null;
  updated_at: string | null;
};

export default function AdminSubscriptionsView() {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.listSubscriptions(status || null);
        if (alive) setRows(res || []);
      } catch (e) {
        alert((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [status]);

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <h2>订阅</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="active">生效中</option>
          <option value="scheduled_cancel">到期不续</option>
          <option value="past_due">扣款失败</option>
          <option value="canceled">已取消</option>
          <option value="expired">已过期</option>
        </select>
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>邮箱</th>
              <th>plan</th>
              <th>状态</th>
              <th>当前周期截止</th>
              <th>取消时间</th>
              <th>更新于</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.muted}>
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.user_id}>
                  <td>{r.email || '—'}</td>
                  <td>{r.plan}</td>
                  <td>
                    <StatusBadge
                      label={subStatusMeta(r.status).label}
                      tone={subStatusMeta(r.status).tone}
                    />
                  </td>
                  <td>{formatTime(r.current_period_end)}</td>
                  <td>{formatTime(r.canceled_at)}</td>
                  <td>{formatTime(r.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
