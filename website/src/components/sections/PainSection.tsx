import { makeT, type Locale } from '@/i18n/t';
import styles from './PainSection.module.css';

// ★ 2026-10 重写（原来 6 张卡里 lost / history / migration 都在说「书签没了或乱了」，
//   互相重叠；mixed 是加分项不是痛点；lock 把「锁定」和「明文」揉成一句）。
//   现在的判据：**每张卡 = 一个用户能亲口说出的具体场景**，且 1:1 对应下面
//   对比矩阵里的某一行 —— 痛点提问题，矩阵给答案。没有对应功能的痛点不写。
const PAINS = [
  { key: 'crossBrowser', icon: 'browser' },
  { key: 'treeLost', icon: 'tree' },
  { key: 'resurrect', icon: 'undo' },
  { key: 'overwrite', icon: 'overwrite' },
  { key: 'order', icon: 'order' },
  { key: 'plaintext', icon: 'lock' },
] as const;

const ICONS: Record<string, string> = {
  // 窗口 + 内部隔断 = 各自封闭、互不相通
  browser: 'M3 9h18M9 21V9M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z',
  // 树：一个父节点带两个子节点 = 改名后子项失联
  tree: 'M12 3v6M12 9L6 15v6M12 9l6 6v6M3 21h6M15 21h6',
  // 回旋箭头 = 删除又回来
  undo: 'M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8m0-5v5h5',
  // 两条相反的箭头交叉 = 互相覆盖
  overwrite: 'M4 7h9M9 3l4 4-4 4M20 17h-9M15 21l-4-4 4-4',
  // 上下箭头 = 排序
  order: 'M8 20V6M8 6L5 9M8 6l3 3M16 4v14M16 18l-3-3M16 18l3-3',
  // 挂锁 = 明文存云端
  lock: 'M12 17v-3m0-8V4a1 1 0 00-1-1H9a1 1 0 00-1 1v2M7 8h10a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2v-8a2 2 0 012-2z',
};

export default function PainSection({ locale }: { locale: Locale }) {
  const t = makeT(locale);
  return (
    <section id="pain" className={`section ${styles.sectionPain}`}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className="section-eyebrow">{t('pain.eyebrow')}</p>
          <h2 className="section-title">{t('pain.title')}</h2>
          <p className="section-subtitle">{t('pain.subtitle')}</p>
        </div>

        <div className={styles.painGrid}>
          {PAINS.map((pain) => (
            <div key={pain.key} className={`card card-hover ${styles.painCard}`}>
              <div className={styles.painIcon}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={ICONS[pain.icon]} />
                </svg>
              </div>
              <h3 className={styles.painTitle}>{t(`pain.items.${pain.key}.title`)}</h3>
              <p className={styles.painDesc}>{t(`pain.items.${pain.key}.desc`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
