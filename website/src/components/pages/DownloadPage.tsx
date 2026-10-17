'use client';

import { useState } from 'react';
import { useLocale } from '@/i18n/LocaleProvider';
import { supabase } from '@/lib/supabase.js';
import { STORAGE_BASE, useLatestVersion } from '@/lib/useLatestVersion';
import { useStoreVersions, type StoreKey } from '@/lib/useStoreVersions';
import styles from './DownloadPage.module.css';

// 三家商店已上架：卡片直达商店详情页。
//
// 版本号有两个口径，刻意分开展示（详见 lib/useLatestVersion / useStoreVersions）：
//   - 「最新发布」= latest.json，我们已发布的版本，决定离线安装包下载链接；
//   - 「商店在架」= stores.json，商店实际在售的版本 —— 审核有延迟，常落后于前者。
// 只显示其中一个会让用户点进商店后看到不一致的版本号。
const BROWSERS: { key: StoreKey; color: string; url: string }[] = [
  {
    key: 'chrome',
    color: '#4285F4',
    url: 'https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml',
  },
  {
    key: 'edge',
    color: '#0078D7',
    url: 'https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah',
  },
  {
    key: 'firefox',
    color: '#FF7139',
    url: 'https://addons.mozilla.org/zh-CN/firefox/addon/bookmark-sync-app/',
  },
];

const ICON_PATHS: Record<StoreKey, string> = {
  chrome: 'M12 2a10 10 0 11-5 18.66L9 13l3-1V2z',
  edge: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  firefox: 'M12 2C8 2 5 5 5 9c0 4 3 7 7 7s7-3 7-7',
};

export default function DownloadPage() {
  const { t, tm } = useLocale();

  const version = useLatestVersion();
  const storeVersions = useStoreVersions();

  const chromiumZip = `${STORAGE_BASE}/bookmark-sync-chromium-${version}.zip`;
  const firefoxZip = `${STORAGE_BASE}/bookmark-sync-firefox-${version}.zip`;

  const steps = (tm('download.manual.steps') as string[]) || [];

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 订阅版本更新：写入 Supabase bsync_waitlist（需先在远端执行 0025_waitlist.sql 迁移）
  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email || !email.includes('@')) return;
    setError('');
    setBusy(true);
    try {
      const { error: err } = await supabase
        .from('bsync_waitlist')
        .insert({ email, source: 'download' });
      if (err) throw err;
      setSubmitted(true);
      setEmail('');
    } catch {
      setError(t('download.subscribe.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.downloadPage}>
      <section className={`section ${styles.downloadHero}`}>
        <div className="container">
          <div className={styles.sectionHeader}>
            <p className="section-eyebrow">{t('download.eyebrow')}</p>
            <h1 className="section-title">{t('download.title')}</h1>
            <p className="section-subtitle">{t('download.subtitle')}</p>
            <p className={styles.versionBadge}>{t('download.versionBadge', { version })}</p>
          </div>

          <div className={styles.browserGrid}>
            {BROWSERS.map((b) => {
              const sv = storeVersions[b.key];
              return (
                <a
                  key={b.key}
                  href={b.url}
                  target="_blank"
                  rel="noopener"
                  className={styles.browserCard}
                >
                  <div className={styles.browserIcon} style={{ background: b.color }}>
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d={ICON_PATHS[b.key]} />
                    </svg>
                  </div>
                  <div className={styles.browserInfo}>
                    <h3 className={styles.browserName}>{t(`browsers.${b.key}.name`)}</h3>
                    <p className={styles.browserStore}>
                      {t(`browsers.${b.key}.desc`)}
                      {sv ? (
                        <>
                          {' · '}
                          {t('browsers.storeVersion', { version: sv.version })}
                          {sv.pending ? (
                            <>
                              {' · '}
                              {t('browsers.pending', { version: sv.pending })}
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <span className={styles.browserCta}>
                    {t('download.cta')}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M7 17L17 7M17 7H8M17 7v9"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {/* 离线安装包——商店安装不便时的备用路径 */}
      <section id="manual" className={`section ${styles.manualSection}`}>
        <div className={`container ${styles.containerNarrow}`}>
          <div className={styles.manualCard}>
            <h2 className={styles.manualTitle}>{t('download.manual.title', { version })}</h2>
            <p className={styles.manualSub}>{t('download.manual.subtitle')}</p>

            <div className={styles.manualCtas}>
              <a
                href={chromiumZip}
                download
                className={`btn btn-primary btn-lg ${styles.manualCta}`}
              >
                {t('download.manual.chromiumCta')}
              </a>
              <a
                href={firefoxZip}
                download
                className={`btn btn-outline btn-lg ${styles.manualCta}`}
              >
                {t('download.manual.firefoxCta')}
              </a>
            </div>

            <ol className={styles.manualSteps}>
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* 邮箱订阅：新版本发布时通知 */}
      <section id="subscribe" className={`section ${styles.subscribeSection}`}>
        <div className="container">
          <div className={styles.subscribeCard}>
            <div className={styles.subscribeHeader}>
              <h2 className={styles.subscribeTitle}>{t('download.subscribe.title')}</h2>
              <p className={styles.subscribeSubtitle}>{t('download.subscribe.subtitle')}</p>
            </div>

            {!submitted ? (
              <form className={styles.subscribeForm} onSubmit={subscribe}>
                <input
                  type="email"
                  className={styles.subscribeInput}
                  placeholder={t('common.subscribePlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
                  {busy ? t('download.subscribe.submitting') : t('download.subscribe.submit')}
                </button>
              </form>
            ) : (
              <p className={styles.subscribeSuccess}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t('download.subscribe.success')}
              </p>
            )}

            {error ? <p className={styles.subscribeError}>{error}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
