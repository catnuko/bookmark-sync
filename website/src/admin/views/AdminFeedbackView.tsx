'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../lib/client.js';
import DataTable, { type Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import {
  formatTime,
  timeAgo,
  formatCount,
  formatAuditDetail,
  feedbackKindMeta,
  feedbackStatusMeta,
} from '../lib/format.js';
import styles from './AdminFeedbackView.module.css';

type FeedbackRow = {
  id: string;
  created_at: string;
  kind: string;
  body: string;
  email?: string;
  contact_email?: string;
  app_version?: string;
  platform?: string;
  locale?: string;
  last_error_phase?: string;
  status: string;
};

type ErrorRow = {
  id: string;
  last_seen_at: string;
  occurrences: number;
  user_count?: number;
  phase: string;
  reason: string;
  error_name?: string;
  error_message?: string;
  app_version?: string;
  platform?: string;
  email?: string;
};

type ErrorDetail = {
  phase: string;
  reason: string;
  error_name?: string;
  email?: string;
  app_version?: string;
  platform?: string;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  fingerprint: string;
  error_message?: string;
  error_stack?: string;
  context?: unknown;
};

const STATUS_OPTIONS = [
  { value: 'new', label: '待处理' },
  { value: 'read', label: '已读' },
  { value: 'resolved', label: '已处理' },
  { value: 'wontfix', label: '不处理' },
];

const KIND_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'bug', label: '问题' },
  { value: 'idea', label: '建议' },
  { value: 'other', label: '其他' },
];

const GROUP_OPTIONS = [
  { value: 'row', label: '按时间' },
  { value: 'fingerprint', label: '按指纹聚合' },
];

const PAGE_SIZE = 50;

export default function AdminFeedbackView() {
  const [tab, setTab] = useState<'feedback' | 'errors'>('feedback');

  // tab 1：反馈
  const [fbRows, setFbRows] = useState<FeedbackRow[]>([]);
  const [fbTotal, setFbTotal] = useState(0);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbPage, setFbPage] = useState(1);
  const [fbStatus, setFbStatus] = useState('');
  const [fbKind, setFbKind] = useState('');
  const [fbBusy, setFbBusy] = useState(false);
  const [fbDetail, setFbDetail] = useState<FeedbackRow | null>(null);

  const loadFeedback = useCallback(async () => {
    setFbLoading(true);
    try {
      const res = await adminApi.listFeedback({
        status: fbStatus || null,
        kind: fbKind || null,
        limit: PAGE_SIZE,
        offset: (fbPage - 1) * PAGE_SIZE,
      });
      setFbRows(res.rows || []);
      setFbTotal(res.total || 0);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setFbLoading(false);
    }
  }, [fbStatus, fbKind, fbPage]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  async function setStatus(row: FeedbackRow, status: string) {
    if (status === row.status) return;
    if (!confirm(`确认把这条反馈标记为「${feedbackStatusMeta(status).label}」？`)) {
      return;
    }
    setFbBusy(true);
    try {
      await adminApi.setFeedbackStatus(row.id, status);
      setFbDetail((d) => (d && d.id === row.id ? { ...d, status } : d));
      await loadFeedback();
    } catch (e) {
      alert((e as Error).message);
      await loadFeedback(); // 失败时回滚下拉框显示
    } finally {
      setFbBusy(false);
    }
  }

  // tab 2：错误上报
  const [erRows, setErRows] = useState<ErrorRow[]>([]);
  const [erTotal, setErTotal] = useState(0);
  const [erLoading, setErLoading] = useState(false);
  const [erPage, setErPage] = useState(1);
  const [erPhase, setErPhase] = useState('');
  const [erVersion, setErVersion] = useState('');
  const [erGroup, setErGroup] = useState('row');
  const [erDetail, setErDetail] = useState<ErrorDetail | null>(null);
  const [erDetailLoading, setErDetailLoading] = useState(false);
  const erLoadedRef = useRef(false);

  const loadErrors = useCallback(async () => {
    setErLoading(true);
    try {
      const res = await adminApi.listErrorReports({
        phase: erPhase || null,
        appVersion: erVersion || null,
        group: erGroup,
        limit: PAGE_SIZE,
        offset: (erPage - 1) * PAGE_SIZE,
      });
      setErRows(res.rows || []);
      setErTotal(res.total || 0);
      erLoadedRef.current = true;
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setErLoading(false);
    }
  }, [erPhase, erVersion, erGroup, erPage]);

  // 懒加载：切到错误 tab 才拉第一次
  useEffect(() => {
    if (tab !== 'errors' || erLoadedRef.current) return;
    erLoadedRef.current = true;
    loadErrors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // 筛选项变化后重载（仅当已加载过）
  useEffect(() => {
    if (!erLoadedRef.current) return;
    loadErrors();
  }, [erPage, erPhase, erVersion, erGroup, loadErrors]);

  async function openErrorDetail(row: ErrorRow) {
    setErDetailLoading(true);
    setErDetail({ id: row.id, phase: row.phase } as unknown as ErrorDetail);
    try {
      setErDetail(await adminApi.getErrorReport(row.id));
    } catch (e) {
      alert((e as Error).message);
      setErDetail(null);
    } finally {
      setErDetailLoading(false);
    }
  }

  const fbColumns: Column<FeedbackRow>[] = [
    {
      key: 'time',
      header: '时间',
      className: styles.nowrap,
      cell: (r) => formatTime(r.created_at),
    },
    {
      key: 'kind',
      header: '类型',
      cell: (r) => {
        const m = feedbackKindMeta(r.kind);
        return <StatusBadge label={m.label} tone={m.tone} />;
      },
    },
    {
      key: 'body',
      header: '内容',
      className: styles.bodyCell,
      cell: (r) => (
        <>
          <span className={styles.bodyPreview}>{r.body}</span>
          <button className={styles.link} type="button" onClick={() => setFbDetail(r)}>
            查看
          </button>
        </>
      ),
    },
    { key: 'email', header: '提交者', cell: (r) => r.email || '—' },
    {
      key: 'env',
      header: '环境',
      className: styles.env,
      cell: (r) => `${r.app_version || '—'} · ${r.platform || '—'}`,
    },
    {
      key: 'status',
      header: '状态',
      cell: (r) => {
        const m = feedbackStatusMeta(r.status);
        return <StatusBadge label={m.label} tone={m.tone} />;
      },
    },
    {
      key: 'mark',
      header: '标记',
      cell: (r) => (
        <select value={r.status} disabled={fbBusy} onChange={(e) => setStatus(r, e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ),
    },
  ];

  const erColumns: Column<ErrorRow>[] = [
    {
      key: 'time',
      header: '最后出现',
      className: styles.nowrap,
      cell: (r) => timeAgo(r.last_seen_at),
    },
    { key: 'count', header: '次数', cell: (r) => formatCount(r.occurrences) },
    ...(erGroup === 'fingerprint'
      ? [
          {
            key: 'users',
            header: '影响用户',
            cell: (r: ErrorRow) => formatCount(r.user_count),
          } as Column<ErrorRow>,
        ]
      : []),
    { key: 'phase', header: '阶段', className: styles.nowrap, cell: (r) => r.phase },
    { key: 'reason', header: '原因', className: styles.nowrap, cell: (r) => r.reason },
    { key: 'name', header: '错误', className: styles.nowrap, cell: (r) => r.error_name || '—' },
    {
      key: 'msg',
      header: '消息',
      className: styles.bodyCell,
      cell: (r) => <span className={styles.bodyPreview}>{r.error_message || '—'}</span>,
    },
    {
      key: 'env',
      header: '版本 / 平台',
      className: styles.env,
      cell: (r) => `${r.app_version || '—'} · ${r.platform || '—'}`,
    },
    ...(erGroup === 'row'
      ? [
          {
            key: 'user',
            header: '用户',
            cell: (r: ErrorRow) => r.email || '—',
          } as Column<ErrorRow>,
          {
            key: 'open',
            header: '',
            cell: (r: ErrorRow) => (
              <button className={styles.link} type="button" onClick={() => openErrorDetail(r)}>
                详情
              </button>
            ),
          } as Column<ErrorRow>,
        ]
      : []),
  ];

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <h2>反馈</h2>
        <div className={styles.tabs}>
          <button
            className={tab === 'feedback' ? styles.active : ''}
            type="button"
            onClick={() => setTab('feedback')}
          >
            用户反馈
          </button>
          <button
            className={tab === 'errors' ? styles.active : ''}
            type="button"
            onClick={() => setTab('errors')}
          >
            错误上报
          </button>
        </div>
      </div>

      {/* ============ 用户反馈 ============ */}
      {tab === 'feedback' ? (
        <>
          <div className={styles.filters}>
            <select
              value={fbStatus}
              onChange={(e) => {
                setFbPage(1);
                setFbStatus(e.target.value);
              }}
            >
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={fbKind}
              onChange={(e) => {
                setFbPage(1);
                setFbKind(e.target.value);
              }}
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <p className={styles.muted}>
            用户在插件内主动提交的反馈。环境列（版本 / 浏览器 / 语言 / 错误阶段）由插件自动附带，
            绝不含书签内容。
          </p>

          <DataTable
            loading={fbLoading}
            rows={fbRows}
            total={fbTotal}
            page={fbPage}
            pageSize={PAGE_SIZE}
            columns={fbColumns}
            onPageChange={setFbPage}
            renderCard={(r) => {
              const km = feedbackKindMeta(r.kind);
              const sm = feedbackStatusMeta(r.status);
              return (
                <article className={styles.card}>
                  <div className={styles.cHead}>
                    <StatusBadge label={km.label} tone={km.tone} />
                    <StatusBadge label={sm.label} tone={sm.tone} />
                    <span className={styles.cTime}>{formatTime(r.created_at)}</span>
                  </div>
                  <p className={styles.cBody}>{r.body}</p>
                  <div className={styles.cRow}>
                    <span className={styles.cK}>提交者</span>
                    <span>{r.email || '—'}</span>
                  </div>
                  <div className={styles.cRow}>
                    <span className={styles.cK}>环境</span>
                    <span>
                      {r.app_version || '—'} · {r.platform || '—'}
                    </span>
                  </div>
                  <div className={styles.cActions}>
                    <button className={styles.link} type="button" onClick={() => setFbDetail(r)}>
                      查看详情
                    </button>
                    <select
                      value={r.status}
                      disabled={fbBusy}
                      onChange={(e) => setStatus(r, e.target.value)}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              );
            }}
          />
        </>
      ) : (
        <>
          <div className={styles.filters}>
            <select
              value={erGroup}
              onChange={(e) => {
                setErPage(1);
                setErGroup(e.target.value);
              }}
            >
              {GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={erPhase}
              placeholder="phase（如 sync）"
              onChange={(e) => setErPhase(e.target.value.trim())}
              onKeyUp={(e) => {
                if (e.key === 'Enter') {
                  setErPage(1);
                  loadErrors();
                }
              }}
            />
            <input
              value={erVersion}
              placeholder="版本（如 2.7.0）"
              onChange={(e) => setErVersion(e.target.value.trim())}
              onKeyUp={(e) => {
                if (e.key === 'Enter') {
                  setErPage(1);
                  loadErrors();
                }
              }}
            />
            <button
              className={styles.btn}
              type="button"
              onClick={() => {
                setErPage(1);
                loadErrors();
              }}
            >
              筛选
            </button>
          </div>
          <p className={styles.muted}>
            插件自动上报的同步错误元数据（0042）。只有错误类型与调用阶段，不含书签内容。
            「按指纹聚合」按总次数排序，用于判断哪个错误影响面最大。
          </p>

          <DataTable
            loading={erLoading}
            rows={erRows}
            total={erTotal}
            page={erPage}
            pageSize={PAGE_SIZE}
            columns={erColumns}
            onPageChange={setErPage}
            renderCard={(r) => (
              <article className={styles.card}>
                <div className={styles.cHead}>
                  <span className={styles.cTime}>{timeAgo(r.last_seen_at)}</span>
                  <span className={styles.cBadge}>{formatCount(r.occurrences)} 次</span>
                  {erGroup === 'fingerprint' ? (
                    <span className={styles.cBadge}>{formatCount(r.user_count)} 人</span>
                  ) : null}
                </div>
                <div className={styles.cRow}>
                  <span className={styles.cK}>阶段</span>
                  <span>
                    {r.phase} / {r.reason}
                  </span>
                </div>
                <div className={styles.cRow}>
                  <span className={styles.cK}>错误</span>
                  <span>{r.error_name || '—'}</span>
                </div>
                <p className={styles.cBody}>{r.error_message || '—'}</p>
                <div className={styles.cActions}>
                  <span className={styles.cK}>
                    {r.app_version || '—'} · {r.platform || '—'}
                  </span>
                  {erGroup === 'row' ? (
                    <button
                      className={styles.link}
                      type="button"
                      onClick={() => openErrorDetail(r)}
                    >
                      详情
                    </button>
                  ) : null}
                </div>
              </article>
            )}
          />
        </>
      )}

      {/* 反馈详情 */}
      {fbDetail ? (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFbDetail(null);
          }}
        >
          <div className={styles.modal}>
            <div className={styles.mHead}>
              <h3>反馈详情</h3>
              <button className={styles.link} type="button" onClick={() => setFbDetail(null)}>
                关闭
              </button>
            </div>
            <div className={styles.mMeta}>
              <StatusBadge
                label={feedbackKindMeta(fbDetail.kind).label}
                tone={feedbackKindMeta(fbDetail.kind).tone}
              />
              <StatusBadge
                label={feedbackStatusMeta(fbDetail.status).label}
                tone={feedbackStatusMeta(fbDetail.status).tone}
              />
              <span>{formatTime(fbDetail.created_at)}</span>
            </div>
            <pre className={styles.mBody}>{fbDetail.body}</pre>
            <div className={styles.mRow}>
              <span className={styles.cK}>提交者</span>
              <span>{fbDetail.email || '—'}</span>
            </div>
            <div className={styles.mRow}>
              <span className={styles.cK}>回信邮箱</span>
              <span>{fbDetail.contact_email || '（未填，无法回复）'}</span>
            </div>
            <div className={styles.mRow}>
              <span className={styles.cK}>环境</span>
              <span>
                {fbDetail.app_version || '—'} · {fbDetail.platform || '—'} ·{' '}
                {fbDetail.locale || '—'} · 错误阶段 {fbDetail.last_error_phase || '—'}
              </span>
            </div>
            <div className={styles.mActions}>
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`${styles.btn} ${o.value === fbDetail.status ? styles.primary : ''}`}
                  type="button"
                  disabled={fbBusy}
                  onClick={() => setStatus(fbDetail, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* 错误上报详情 */}
      {erDetail ? (
        <div
          className={styles.overlay}
          onClick={(e) => {
            if (e.target === e.currentTarget) setErDetail(null);
          }}
        >
          <div className={styles.modal}>
            <div className={styles.mHead}>
              <h3>错误详情</h3>
              <button className={styles.link} type="button" onClick={() => setErDetail(null)}>
                关闭
              </button>
            </div>
            {erDetailLoading ? (
              <p className={styles.muted}>加载中…</p>
            ) : (
              <>
                <div className={styles.mRow}>
                  <span className={styles.cK}>阶段 / 原因</span>
                  <span>
                    {erDetail.phase} / {erDetail.reason}
                  </span>
                </div>
                <div className={styles.mRow}>
                  <span className={styles.cK}>错误</span>
                  <span>{erDetail.error_name || '—'}</span>
                </div>
                <div className={styles.mRow}>
                  <span className={styles.cK}>用户</span>
                  <span>{erDetail.email || '—'}</span>
                </div>
                <div className={styles.mRow}>
                  <span className={styles.cK}>版本 / 平台</span>
                  <span>
                    {erDetail.app_version || '—'} · {erDetail.platform || '—'}
                  </span>
                </div>
                <div className={styles.mRow}>
                  <span className={styles.cK}>次数 / 区间</span>
                  <span>
                    {formatCount(erDetail.occurrences)} 次 · {formatTime(erDetail.first_seen_at)} →{' '}
                    {formatTime(erDetail.last_seen_at)}
                  </span>
                </div>
                <div className={styles.mRow}>
                  <span className={styles.cK}>指纹</span>
                  <span className={styles.mono}>{erDetail.fingerprint}</span>
                </div>
                <h4>错误消息</h4>
                <pre className={styles.mBody}>{erDetail.error_message || '—'}</pre>
                <h4>调用栈</h4>
                <pre className={styles.mBody}>{erDetail.error_stack || '（无）'}</pre>
                <h4>上下文</h4>
                <pre className={styles.mBody}>{formatAuditDetail(erDetail.context)}</pre>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
