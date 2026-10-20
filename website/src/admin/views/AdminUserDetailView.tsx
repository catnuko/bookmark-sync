'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../lib/client.js';
import StatusBadge from '../components/StatusBadge';
import {
  formatBytes,
  formatCount,
  formatTime,
  planLabel,
  planTone,
  orderStatusMeta,
  subStatusMeta,
} from '../lib/format.js';
import styles from './AdminUserDetailView.module.css';

type UserDetail = {
  email: string;
  profile?: {
    plan?: string;
    used_bytes?: number;
    quota_bytes?: number;
    used_count?: number;
    purchased_at?: string | null;
    e2ee_salt?: string | null;
    /** 0052：auto = Creem 订阅驱动；manual = 管理员手工授予（微信转账等）。 */
    plan_source?: 'auto' | 'manual';
    /** 0052：手工授予的到期时间，到期自动降 free。 */
    plan_expires_at?: string | null;
  };
  subscription?: {
    status: string;
    plan: string;
    current_period_end: string | null;
    creem_customer_id?: string | null;
  } | null;
  spaces?: {
    id: string;
    name: string;
    is_default?: boolean;
    op_count: number;
    device_count: number;
    created_at: string;
  }[];
  devices?: {
    id: string;
    name?: string;
    space_name: string;
    last_seen_at: string | null;
    /** 扩展版本（0050）。存量设备在下一次心跳前为空。 */
    app_version?: string | null;
  }[];
  recent_orders?: {
    id: string;
    created_at: string;
    plan: string;
    amount_cents: number | null;
    currency: string;
    status: string;
  }[];
};

type GcStats = {
  profile?: {
    effective_gc_threshold?: number | null;
    last_gc_at?: string | null;
    gc_requested?: boolean;
    used_count?: number;
    gc_threshold?: number | null;
  };
  spaces?: {
    id: string;
    name: string;
    is_default?: boolean;
    op_count: number;
    snapshot_bytes?: number | null;
    snapshot_after_op_id?: number | null;
    snapshot_created_at?: string | null;
  }[];
};

/**
 * 拼「浏览器 · 系统 · 版本」。
 *
 * `name` 是客户端 detectDeviceName() 生成的 "Edge · Windows"（见 src/sync.ts），
 * 已经含浏览器与系统，这里只补版本；用户改过名的设备（bsync_device_rename）
 * 可能不含这些信息，此时照样把版本接在后面 —— 版本才是这一列的重点。
 * 存量设备在下次心跳前没有版本，显示「(版本未知)」而不是留空。
 */
function deviceLabel(name?: string, version?: string | null): string {
  const base = (name || '').trim() || '(未命名)';
  return version ? `${base} · ${version}` : `${base} · (版本未知)`;
}

export default function AdminUserDetailView({ userId }: { userId: string }) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newPlan, setNewPlan] = useState('');
  /** 手工授予的到期时间（datetime-local 字符串）。0052：非 free 必填。 */
  const [newPlanExpiresAt, setNewPlanExpiresAt] = useState('');

  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');

  const [gc, setGc] = useState<GcStats | null>(null);
  const [gcLoading, setGcLoading] = useState(true);
  const [gcError, setGcError] = useState('');
  const [gcThresholdInput, setGcThresholdInput] = useState('');
  const [gcBusy, setGcBusy] = useState(false);
  const [gcMsg, setGcMsg] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d: UserDetail = await adminApi.getUser(userId);
        if (alive) {
          setData(d);
          setNewPlan(d.profile?.plan || 'free');
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const loadGc = useCallback(async () => {
    setGcLoading(true);
    setGcError('');
    try {
      const g: GcStats = await adminApi.getGcStats(userId);
      setGc(g);
      setGcThresholdInput(String(g.profile?.gc_threshold ?? 0));
    } catch (e) {
      setGcError((e as Error).message);
    } finally {
      setGcLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadGc();
  }, [loadGc]);

  async function savePlan() {
    // 0052：非 free 计划必须给到期时间（手工授予，到期自动降 free）
    let expiresAt: string | null = null;
    if (newPlan !== 'free') {
      if (!newPlanExpiresAt) {
        alert('手工开通会员必须填写到期时间（到期后自动降为 free）');
        return;
      }
      const d = new Date(newPlanExpiresAt);
      if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now()) {
        alert('到期时间必须晚于当前时间');
        return;
      }
      expiresAt = d.toISOString();
    }

    const hint =
      newPlan === 'free'
        ? `确认将该用户 plan 改为 free？`
        : `确认将该用户 plan 改为 ${newPlan}，到期时间 ${new Date(newPlanExpiresAt).toLocaleString()}？\n\n到期后会自动降为 free。`;
    if (!confirm(hint)) return;
    try {
      await adminApi.setUserPlan(userId, newPlan, expiresAt);
      setData(await adminApi.getUser(userId));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function resetUsage() {
    if (!confirm('确认清零该用户的 used_bytes / used_count？（客服补偿用）')) return;
    try {
      await adminApi.resetUsage(userId);
      setData(await adminApi.getUser(userId));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function saveGcThreshold() {
    const v = parseInt(gcThresholdInput, 10);
    if (!Number.isFinite(v) || v < 0) {
      alert('阈值须为非负整数，0 = 按计划默认');
      return;
    }
    if (!confirm(`将该用户 GC 阈值设为 ${v}？（0 表示按计划默认：free 2000 / pro 20000）`)) return;
    try {
      setGcBusy(true);
      await adminApi.setGcThreshold(userId, v);
      setGcMsg('阈值已更新');
      await loadGc();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setGcBusy(false);
    }
  }

  async function requestGc() {
    if (!confirm('向该用户设备下发 GC 请求：下次同步时自动把操作日志压缩为加密快照并截断。确认？'))
      return;
    try {
      setGcBusy(true);
      await adminApi.requestGc(userId);
      setGcMsg('已下发 GC 请求，等待设备下次同步自动执行');
      await loadGc();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setGcBusy(false);
    }
  }

  async function clearUserData() {
    if (clearMsg) setClearMsg('');
    const first = confirm(
      `确认清空 ${data?.email ?? '该用户'} 的全部云端同步数据？\n\n将删除：空间、操作日志、快照、设备登记，并重置 E2EE 盐与用量。\n此操作不可恢复！`,
    );
    if (!first) return;
    const second = confirm(
      '再次确认：该用户的同步数据将被永久删除，仅保留浏览器本地的书签。确定继续？',
    );
    if (!second) return;
    try {
      setClearing(true);
      const r = await adminApi.resetUserData(userId);
      setData(await adminApi.getUser(userId));
      setClearMsg(
        `已清空 ${r?.email ?? ''}：空间 ${r?.spaces ?? 0} 个、操作日志 ${r?.op_log ?? 0} 条、快照 ${r?.snapshots ?? 0} 份、设备 ${r?.devices ?? 0} 台。`,
      );
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className={styles.page}>
      <a href="/admin/users" className={styles.back}>
        ← 返回用户列表
      </a>
      {data ? <h2>{data.email}</h2> : null}
      {error ? <p className={styles.err}>{error}</p> : null}
      {loading ? <p>加载中…</p> : null}

      {!loading && data ? (
        <>
          <div className={styles.cols}>
            <section className={styles.card}>
              <h3>档案</h3>
              <p>
                plan：
                <StatusBadge
                  label={planLabel(data.profile?.plan)}
                  tone={planTone(data.profile?.plan)}
                />
              </p>
              <p>
                用量：{formatBytes(data.profile?.used_bytes)} /{' '}
                {formatBytes(data.profile?.quota_bytes)}
              </p>
              <p>条数：{formatCount(data.profile?.used_count)}</p>
              <p>购买时间：{formatTime(data.profile?.purchased_at)}</p>
              <p>
                计划来源：
                {data.profile?.plan_source === 'manual' ? (
                  <>
                    <strong>手工授予</strong>
                    {data.profile?.plan_expires_at
                      ? `（到期 ${formatTime(data.profile.plan_expires_at)}）`
                      : ''}
                  </>
                ) : (
                  '自动（Creem 订阅）'
                )}
              </p>
              <p>E2EE salt：{data.profile?.e2ee_salt ? '已设置' : '未设置（未开启口令模式）'}</p>
              <div className={styles.actions}>
                <select value={newPlan} onChange={(e) => setNewPlan(e.target.value)}>
                  <option value="free">free</option>
                  <option value="plus">plus</option>
                  <option value="pro">pro</option>
                  <option value="lifetime">lifetime</option>
                </select>
                {newPlan !== 'free' ? (
                  <input
                    type="datetime-local"
                    value={newPlanExpiresAt}
                    onChange={(e) => setNewPlanExpiresAt(e.target.value)}
                    title="手工授予必填：到期后自动降为 free"
                  />
                ) : null}
                <button className={styles.btn} type="button" onClick={savePlan}>
                  保存 plan
                </button>
                <button className={styles.btnDanger} type="button" onClick={resetUsage}>
                  重置用量
                </button>
              </div>
            </section>

            <section className={styles.card}>
              <h3>订阅</h3>
              {!data.subscription ? (
                <p className={styles.muted}>无订阅（free 用户）</p>
              ) : (
                <>
                  <p>
                    状态：
                    <StatusBadge
                      label={subStatusMeta(data.subscription.status).label}
                      tone={subStatusMeta(data.subscription.status).tone}
                    />
                  </p>
                  <p>plan：{data.subscription.plan}</p>
                  <p>当前周期截止：{formatTime(data.subscription.current_period_end)}</p>
                  <p className={styles.muted}>
                    creem_customer_id：{data.subscription.creem_customer_id || '—'}
                  </p>
                </>
              )}
            </section>
          </div>

          <div className={styles.cols}>
            <section className={styles.card}>
              <h3>空间（{data.spaces?.length || 0}）</h3>
              <div className={styles.tableScroll}>
                <table className={styles.mini}>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>默认</th>
                      <th>op 数</th>
                      <th>设备数</th>
                      <th>创建</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.spaces?.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.name}
                          {s.is_default ? <span className={styles.tag}>default</span> : null}
                        </td>
                        <td>{s.is_default ? '✓' : ''}</td>
                        <td>{formatCount(s.op_count)}</td>
                        <td>{s.device_count}</td>
                        <td>{formatTime(s.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.card}>
              <h3>设备（{data.devices?.length || 0}）</h3>
              <div className={styles.tableScroll}>
                <table className={styles.mini}>
                  <thead>
                    <tr>
                      <th>设备（浏览器 · 系统 · 版本）</th>
                      <th>空间</th>
                      <th>最后在线</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.devices?.map((d) => (
                      <tr key={d.id}>
                        <td>{deviceLabel(d.name, d.app_version)}</td>
                        <td>{d.space_name}</td>
                        <td>{formatTime(d.last_seen_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className={styles.card}>
            <h3>最近订单（{data.recent_orders?.length || 0}）</h3>
            <div className={styles.tableScroll}>
              <table className={styles.mini}>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>plan</th>
                    <th>金额</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_orders?.map((o) => (
                    <tr key={o.id}>
                      <td>{formatTime(o.created_at)}</td>
                      <td>{o.plan}</td>
                      <td>
                        {o.amount_cents
                          ? (o.amount_cents / 100).toFixed(2) + ' ' + o.currency
                          : '—'}
                      </td>
                      <td>
                        <StatusBadge
                          label={orderStatusMeta(o.status).label}
                          tone={orderStatusMeta(o.status).tone}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.card}>
            <h3>GC 监控与维护</h3>
            {gcError ? (
              <p className={styles.err}>{gcError}</p>
            ) : gcLoading ? (
              <p>加载中…</p>
            ) : gc ? (
              <>
                <div className={styles.gcGrid}>
                  <div className={styles.gcItem}>
                    <span className={styles.gcLabel}>有效 GC 阈值</span>
                    <span className={styles.gcVal}>
                      {gc.profile?.effective_gc_threshold != null
                        ? formatCount(gc.profile.effective_gc_threshold) + ' 行'
                        : '—'}
                    </span>
                  </div>
                  <div className={styles.gcItem}>
                    <span className={styles.gcLabel}>最近压缩</span>
                    <span className={styles.gcVal}>
                      {gc.profile?.last_gc_at ? formatTime(gc.profile.last_gc_at) : '尚未触发'}
                    </span>
                  </div>
                  <div className={styles.gcItem}>
                    <span className={styles.gcLabel}>后台请求状态</span>
                    <span className={styles.gcVal}>
                      {gc.profile?.gc_requested ? '已请求（待设备响应）' : '无'}
                    </span>
                  </div>
                  <div className={styles.gcItem}>
                    <span className={styles.gcLabel}>书签条数</span>
                    <span className={styles.gcVal}>{formatCount(gc.profile?.used_count)}</span>
                  </div>
                </div>

                <div className={styles.tableScroll}>
                  <table className={styles.mini}>
                    <thead>
                      <tr>
                        <th>空间</th>
                        <th>op 行数</th>
                        <th>快照体积</th>
                        <th>快照水位</th>
                        <th>快照时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gc.spaces?.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.name}
                            {s.is_default ? <span className={styles.tag}>default</span> : null}
                          </td>
                          <td>{formatCount(s.op_count)}</td>
                          <td>{s.snapshot_bytes ? formatBytes(s.snapshot_bytes) : '—'}</td>
                          <td>
                            {s.snapshot_after_op_id != null
                              ? formatCount(s.snapshot_after_op_id)
                              : '—'}
                          </td>
                          <td>{s.snapshot_created_at ? formatTime(s.snapshot_created_at) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className={styles.actions}>
                  <input
                    value={gcThresholdInput}
                    type="number"
                    min="0"
                    step="500"
                    aria-label="GC 阈值"
                    className={styles.gcInput}
                    onChange={(e) => setGcThresholdInput(e.target.value)}
                  />
                  <button
                    className={styles.btn}
                    type="button"
                    disabled={gcBusy}
                    onClick={saveGcThreshold}
                  >
                    保存阈值
                  </button>
                  <button
                    className={styles.btn}
                    type="button"
                    disabled={gcBusy}
                    onClick={requestGc}
                  >
                    请求压缩（GC）
                  </button>
                  <button
                    className={styles.btnGhost}
                    type="button"
                    disabled={gcBusy}
                    onClick={loadGc}
                  >
                    刷新
                  </button>
                </div>
                <p className={`${styles.muted} ${styles.gcNote}`}>
                  阈值 0 = 按计划默认（free 2000 / pro
                  20000）。「请求压缩」向设备下发标记，下次同步自动执行——E2EE
                  快照投影必须由客户端生成，后台无法代替。
                </p>
                {gcMsg ? <p className={styles.clearMsg}>{gcMsg}</p> : null}
              </>
            ) : null}
          </section>

          <section className={`${styles.card} ${styles.danger}`}>
            <h3>危险操作：清空测试数据</h3>
            <p className={styles.muted}>
              清空该用户在云端的全部同步数据（空间 / 操作日志 / 快照 / 设备）并重置 E2EE 盐与用量，
              仅保留浏览器本地的书签。用于测试账号清理，不可恢复。
            </p>
            <div className={styles.actions}>
              <button
                className={styles.btnDanger}
                type="button"
                disabled={clearing}
                onClick={clearUserData}
              >
                {clearing ? '清空中…' : '一键清空该用户的同步数据'}
              </button>
            </div>
            {clearMsg ? <p className={styles.clearMsg}>{clearMsg}</p> : null}
          </section>

          <p className={styles.notice}>⚠ 书签内容为端到端加密，后台不展示、也无法解密。</p>
        </>
      ) : null}
    </div>
  );
}
