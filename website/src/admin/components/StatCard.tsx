import styles from './StatCard.module.css';

export default function StatCard({
  label,
  value = '—',
  hint = '',
}: {
  label: string;
  value?: string | number;
  hint?: string;
}) {
  return (
    <div className={styles.stat}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}
