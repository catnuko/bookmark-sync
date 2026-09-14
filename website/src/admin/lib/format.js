// 后台管理 — 纯函数格式化工具（无副作用，便于单测）
// 与官网样式系统共享 CSS 变量，这里只做数据 → 展示字符串的转换。

/** 字节 → 人类可读（B/KB/MB/GB） */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** 条数 → 千分位 */
export function formatCount(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US');
}

/** 分 → 本地化货币字符串（默认 USD） */
export function formatMoney(cents, currency = 'USD') {
  const v = Number(cents) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(v / 100);
  } catch {
    return `${(v / 100).toFixed(2)} ${currency}`;
  }
}

/** ISO 时间 → 本地短时间（YYYY-MM-DD HH:mm） */
export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对时间：x 分钟前 / x 小时前 / x 天前 */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} 个月前`;
  return `${Math.floor(month / 12)} 年前`;
}

/** plan → 中文标签 */
export function planLabel(plan) {
  return ({
    free: 'Free',
    plus: 'Plus',
    pro: 'Pro',
    lifetime: 'Lifetime',
  })[plan] || plan || '—';
}

/** plan → 状态徽章颜色类（与 StatusBadge 配合） */
export function planTone(plan) {
  return ({
    free: 'neutral',
    plus: 'info',
    pro: 'success',
    lifetime: 'warning',
  })[plan] || 'neutral';
}

/** 订单状态 → 中文 + 颜色 */
export function orderStatusMeta(status) {
  return ({
    paid: { label: '已支付', tone: 'success' },
    pending: { label: '待支付', tone: 'warning' },
    refunded: { label: '已退款', tone: 'neutral' },
    failed: { label: '失败', tone: 'danger' },
  })[status] || { label: status || '—', tone: 'neutral' };
}

/** 订阅状态 → 中文 + 颜色 */
export function subStatusMeta(status) {
  return ({
    active: { label: '生效中', tone: 'success' },
    scheduled_cancel: { label: '到期不续', tone: 'warning' },
    past_due: { label: '扣款失败', tone: 'danger' },
    canceled: { label: '已取消', tone: 'neutral' },
    expired: { label: '已过期', tone: 'neutral' },
  })[status] || { label: status || '—', tone: 'neutral' };
}

/** 百分比（0~1 小数）→ 显示字符串 */
export function formatRate(ratio) {
  const n = Number(ratio) || 0;
  return `${(n * 100).toFixed(1)}%`;
}

/** 邮箱脱敏：abc***@example.com */
export function maskEmail(email) {
  if (!email) return '—';
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const head = name.slice(0, 3);
  return `${head}***@${domain}`;
}
