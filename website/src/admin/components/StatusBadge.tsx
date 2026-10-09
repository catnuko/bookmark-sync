import styles from './StatusBadge.module.css';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export default function StatusBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: BadgeTone | string;
}) {
  return <span className={`${styles.badge} ${styles[`t-${tone}`] ?? styles['t-neutral']}`}>{label}</span>;
}
