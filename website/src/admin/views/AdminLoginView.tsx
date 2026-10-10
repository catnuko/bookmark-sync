'use client';

import { useState } from 'react';
import { adminSignIn } from '../lib/auth.js';
import styles from './AdminLoginView.module.css';

export default function AdminLoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const { error: err } = await adminSignIn(email.trim(), password);
    if (err) {
      setError(err.message);
    } else {
      const redirect = new URLSearchParams(window.location.search).get('redirect');
      window.location.assign(redirect || '/admin/');
    }
    setBusy(false);
  }

  return (
    <div className={styles.loginWrap}>
      <form className={styles.loginCard} onSubmit={submit}>
        <h1>BSYNC · Admin</h1>
        <p className={styles.sub}>仅限项目管理员登录。使用你的账号邮箱密码。</p>
        <label className={styles.field}>
          <span>邮箱</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>密码</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className={styles.error}>{error}</p> : null}
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
        <a href="/" className={styles.back}>
          ← 返回官网
        </a>
      </form>
    </div>
  );
}
