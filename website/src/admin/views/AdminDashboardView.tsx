'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import { formatBytes, formatCount, formatMoney, formatRate } from '../lib/format.js';
import StatCard from '../components/StatCard';
import styles from './AdminDashboardView.module.css';

type Overview = {
  total_users: number;
  new_today: number;
  new_7d: number;
  paid_users: number;
  paid_rate: number;
  active_devices_24h: number;
  gmv_today_cents: number;
  orders_today: number;
  oplog_rows: number;
  oplog_bytes: number;
  over_quota_users: number;
  daily_new?: { d: string; n: number }[];
  daily_gmv_cents?: { d: string; cents: number }[];
};

// 把 [{d, n}] 数组转成 SVG polyline points（归一化到 600x160）
function toPoints(arr: { [k: string]: unknown }[] | undefined, key: string): string {
  if (!arr || !arr.length) return '';
  const W = 600,
    H = 160,
    PAD = 4;
  const vals = arr.map((x) => Number(x[key]) || 0);
  const max = Math.max(1, ...vals);
  return arr
    .map((x, i) => {
      const px = PAD + (i / (arr.length - 1 || 1)) * (W - PAD * 2);
      const py = H - PAD - ((Number(x[key]) || 0) / max) * (H - PAD * 2);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');
}

export default function AdminDashboardView() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setData(await adminApi.overview());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const newPoints = toPoints(data?.daily_new, 'n');
  const gmvPoints = toPoints(data?.daily_gmv_cents, 'cents');

  return (
    <div className={styles.page}>
      <h2>概览</h2>
      {error ? <p className={styles.err}>加载失败：{error}</p> : null}

      {loading ? (
        <div className={styles.muted}>加载中…</div>
      ) : data ? (
        <>
          <div className={styles.grid}>
            <StatCard
              label="总用户"
              value={formatCount(data.total_users)}
              hint={`今日新增 ${formatCount(data.new_today)} · 7日 ${formatCount(data.new_7d)}`}
            />
            <StatCard
              label="付费用户"
              value={formatCount(data.paid_users)}
              hint={`付费率 ${formatRate(data.paid_rate)}`}
            />
            <StatCard label="24h 活跃设备" value={formatCount(data.active_devices_24h)} />
            <StatCard
              label="今日 GMV"
              value={formatMoney(data.gmv_today_cents)}
              hint={`订单 ${formatCount(data.orders_today)} 笔`}
            />
            <StatCard
              label="op_log 行数"
              value={formatCount(data.oplog_rows)}
              hint={formatBytes(data.oplog_bytes)}
            />
            <StatCard label="超 80% 配额用户" value={formatCount(data.over_quota_users)} />
          </div>

          <div className={styles.charts}>
            <div className={styles.chartCard}>
              <h3>近 30 天新增用户</h3>
              <svg viewBox="0 0 600 160" preserveAspectRatio="none" className={styles.chart}>
                <polyline points={newPoints} fill="none" stroke="#0066ff" strokeWidth="2" />
              </svg>
            </div>
            <div className={styles.chartCard}>
              <h3>近 30 天 GMV（分）</h3>
              <svg viewBox="0 0 600 160" preserveAspectRatio="none" className={styles.chart}>
                <polyline points={gmvPoints} fill="none" stroke="#047857" strokeWidth="2" />
              </svg>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
