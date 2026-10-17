'use client';

import { adminSignOut } from '../lib/auth.js';
import styles from './AdminForbiddenView.module.css';

export default function AdminForbiddenView() {
  async function logout() {
    await adminSignOut();
    window.location.assign('/admin/login');
  }

  return (
    <div className={styles.fWrap}>
      <h1>403</h1>
      <p>当前账号不是 BookmarkSync 项目管理员，无法访问后台。</p>
      <button type="button" onClick={logout}>
        退出并换号
      </button>
      <a href="/">返回官网</a>
    </div>
  );
}
