'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { formatBytes, formatCount, formatTime, planLabel, planTone } from '../lib/format.js';
import styles from './AdminUsersView.module.css';

type UserRow = {
  user_id: string;
  email?: string;
  plan: string;
  used_bytes: number;
  quota_bytes: number;
  used_count: number;
  device_count: number;
  space_count: number;
  created_at: string;
  last_seen_at: string | null;
};

const PAGE_SIZE = 50;

export default function AdminUsersView() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await adminApi.listUsers({
          search: search || null,
          plan: plan || null,
          sort: 'recent',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, nonce]);

  function onSearch() {
    setPage(1);
    setNonce((n) => n + 1);
  }

  const columns: Column<UserRow>[] = [
    { key: 'email', header: '邮箱', cell: (r) => r.email },
    {
      key: 'plan',
      header: 'plan',
      cell: (r) => <StatusBadge label={planLabel(r.plan)} tone={planTone(r.plan)} />,
    },
    {
      key: 'usage',
      header: '用量',
      cell: (r) => `${formatBytes(r.used_bytes)} / ${formatBytes(r.quota_bytes)}`,
    },
    { key: 'count', header: '条数', cell: (r) => formatCount(r.used_count) },
    { key: 'devices', header: '设备', cell: (r) => r.device_count },
    { key: 'spaces', header: '空间', cell: (r) => r.space_count },
    { key: 'created', header: '注册时间', cell: (r) => formatTime(r.created_at) },
    { key: 'last', header: '最后活跃', cell: (r) => formatTime(r.last_seen_at) },
    {
      key: 'open',
      header: '',
      cell: (r) => (
        <a className={styles.link} href={`/admin/users/${r.user_id}`}>
          详情 →
        </a>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <h2>用户</h2>
        <div className={styles.filters}>
          <input
            value={search}
            placeholder="搜索邮箱…"
            onChange={(e) => setSearch(e.target.value)}
            onKeyUp={(e) => {
              if (e.key === 'Enter') onSearch();
            }}
          />
          <select
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value);
              setPage(1);
              setNonce((n) => n + 1);
            }}
          >
            <option value="">全部 plan</option>
            <option value="free">Free</option>
            <option value="plus">Plus</option>
            <option value="pro">Pro</option>
            <option value="lifetime">Lifetime</option>
          </select>
          <button className={styles.btn} type="button" onClick={onSearch}>
            查询
          </button>
        </div>
      </div>

      <DataTable
        loading={loading}
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        columns={columns}
        onPageChange={setPage}
        renderCard={(r) => (
          <article className={styles.uCard}>
            <div className={styles.uHead}>
              <span className={styles.uMail}>{r.email}</span>
              <StatusBadge label={planLabel(r.plan)} tone={planTone(r.plan)} />
            </div>
            <div className={styles.uRow}>
              <span className={styles.uK}>用量</span>
              <span className={styles.uV}>
                {formatBytes(r.used_bytes)} / {formatBytes(r.quota_bytes)}
              </span>
            </div>
            <div className={styles.uRow}>
              <span className={styles.uK}>条数</span>
              <span className={styles.uV}>{formatCount(r.used_count)}</span>
            </div>
            <div className={styles.uRow}>
              <span className={styles.uK}>设备 / 空间</span>
              <span className={styles.uV}>
                {r.device_count} / {r.space_count}
              </span>
            </div>
            <div className={styles.uRow}>
              <span className={styles.uK}>注册时间</span>
              <span className={styles.uV}>{formatTime(r.created_at)}</span>
            </div>
            <div className={styles.uRow}>
              <span className={styles.uK}>最后活跃</span>
              <span className={styles.uV}>{formatTime(r.last_seen_at)}</span>
            </div>
            <a className={`${styles.link} ${styles.uOpen}`} href={`/admin/users/${r.user_id}`}>
              详情 →
            </a>
          </article>
        )}
      />
    </div>
  );
}
