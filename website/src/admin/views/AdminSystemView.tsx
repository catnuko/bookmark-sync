'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import StatCard from '../components/StatCard';
import { formatBytes, formatCount, timeAgo } from '../lib/format.js';
import styles from './AdminSystemView.module.css';

type SystemStats = {
  oplog_rows: number;
  oplog_bytes: number;
  snapshot_count: number;
  latest_snapshot_at: string | null;
  pending_gc_users: number;
  over_threshold_spaces: number;
  top_users: { user_id: string; email?: string; oplog_rows: number; oplog_bytes: number }[];
};

export default function AdminSystemView() {
  const [data, setData] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setData(await adminApi.systemStats());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className={styles.page}>
      <h2>系统监控</h2>
      {error ? <p className={styles.err}>{error}</p> : null}
      {loading ? (
        <p>加载中…</p>
      ) : data ? (
        <>
          <div className={styles.grid}>
            <StatCard label="op_log 总行数" value={formatCount(data.oplog_rows)} />
            <StatCard label="op_log 占用" value={formatBytes(data.oplog_bytes)} />
            <StatCard label="快照数" value={formatCount(data.snapshot_count)} />
            <StatCard
              label="最近 GC"
              value={data.latest_snapshot_at ? timeAgo(data.latest_snapshot_at) : '—'}
              hint={data.latest_snapshot_at || '暂无快照'}
            />
            <StatCard
              label="待响应 GC 用户"
              value={formatCount(data.pending_gc_users)}
              hint="后台已请求、设备尚未执行的用户数"
            />
            <StatCard
              label="超阈值空间"
              value={formatCount(data.over_threshold_spaces)}
              hint="op 行数超过各自用户动态阈值的空间数（即将自动压缩）"
            />
          </div>

          <section className={styles.card}>
            <h3>op_log 占用 Top 10 用户（仅元数据，不解密）</h3>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>邮箱</th>
                    <th>op 行数</th>
                    <th>字节</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_users.map((u) => (
                    <tr key={u.user_id}>
                      <td>{u.email || u.user_id}</td>
                      <td>{formatCount(u.oplog_rows)}</td>
                      <td>{formatBytes(u.oplog_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
