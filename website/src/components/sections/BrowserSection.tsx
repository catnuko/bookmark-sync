'use client';

import { useLocale } from '@/i18n/LocaleProvider';
import { useStoreVersions, type StoreKey } from '@/lib/useStoreVersions';
import styles from './BrowserSection.module.css';

// 三家商店均已上架，卡片直达商店详情页
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

// 浏览器图标统一用一个简洁的圆形书签符号，颜色用品牌色区分
const ICON_PATHS: Record<StoreKey, string> = {
  chrome: 'M12 2a10 10 0 11-5 18.66L9 13l3-1V2zM12 2v10l9-3M3 22l9-9',
  edge: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 3a6 6 0 00-6 6c0 4 3 5 6 5s6 1 6 5a6 6 0 00-6-12z',
  firefox: 'M12 2C8 2 5 5 5 9c0 4 3 7 7 7s7-3 7-7',
};

export default function BrowserSection() {
  const { t } = useLocale();
  // 商店在架版本（stores.json，定时采集）。拉取失败时不显示，不影响卡片本身。
  const storeVersions = useStoreVersions();

  return (
    <section id="browsers" className={`section ${styles.sectionBrowsers}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('browsers.eyebrow')}</p>
          <h2 className="section-title">{t('browsers.title')}</h2>
          <p className="section-subtitle">{t('browsers.subtitle')}</p>
        </div>

        <div className={styles.browserGrid}>
          {BROWSERS.map((b) => (
            <a
              key={b.key}
              href={b.url}
              target="_blank"
              rel="noopener"
              className={`browser-card card card-hover ${styles.browserCard}`}
            >
              <div className={styles.browserIcon} style={{ background: b.color }}>
                <svg
                  width="28"
                  height="28"
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
                  {storeVersions[b.key] ? (
                    <> · {t('browsers.storeVersion', { version: storeVersions[b.key]!.version })}</>
                  ) : null}
                </p>
              </div>
              <div className={styles.browserAction}>
                <span className={styles.browserCta}>{t('download.cta')}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 17L17 7M17 7H8M17 7v9"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
