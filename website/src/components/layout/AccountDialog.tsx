'use client';

// 登录 / 注册弹窗 —— 官网订阅前需要先有 Supabase 登录态（与扩展同账号）。
//
// ★ 必须 portal 到 body（等价于 Vue 的 Teleport）。弹窗从 AccountMenu 与 PricingCard
//   两处唤起；`.header` 上有 backdrop-filter，会为所有后代创建包含块，弹窗的
//   position:fixed 会被困在 header 条内 → 弹窗被顶出视口、标题被裁。portal 到 body 后
//   fixed 重新相对视口。z-index 也要抬过 header 的 50。
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/i18n/LocaleProvider';
import { signIn, signUp } from '@/lib/account.js';
import styles from './AccountDialog.module.css';

export default function AccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const { error: err } = await signIn(email.trim(), password);
        if (err) setError(err.message);
        else onClose();
      } else {
        const { error: err, needsEmailConfirm } = await signUp(email.trim(), password);
        if (err) setError(err.message);
        else if (needsEmailConfirm) setInfo(t('account.emailConfirmSent'));
        else onClose();
      }
    } catch (e) {
      setError((e as Error)?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className={styles.dialogMask} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <h3 className={styles.dialogTitle}>
          {mode === 'login' ? t('account.loginTitle') : t('account.registerTitle')}
        </h3>
        <p className={styles.dialogSub}>{t('account.loginSub')}</p>

        <form onSubmit={submit}>
          <label className={styles.field}>
            <span>{t('account.email')}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('account.password')}</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className={styles.dialogError}>{error}</p>}
          {info && <p className={styles.dialogInfo}>{info}</p>}

          <button
            className={`btn btn-primary ${styles.dialogSubmit}`}
            type="submit"
            disabled={busy}
          >
            {busy
              ? t('account.processing')
              : mode === 'login'
                ? t('account.login')
                : t('account.register')}
          </button>
        </form>

        <button
          className={styles.dialogSwitch}
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t('account.toRegister') : t('account.toLogin')}
        </button>
        <button
          className={styles.dialogClose}
          type="button"
          aria-label={t('account.close')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
    </div>,
    document.body,
  );
}
