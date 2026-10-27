// 首页对比矩阵的**数据唯一来源**（中英双语）。
//
// ★ 为什么放在 TS 而不是 i18n json：这是一张表，列是产品、行是维度，
//   拆成 json 键会变成 `compare.rows.0.cells.2` 这种没法 diff 的结构；
//   而这里每一行就是一个对象，改一处只动一行，中英并排也好看。
// ★ 文案必须与文章 `/explain/bookmark-sync-vs-alternatives` 的结论一致：
//   首页只给结论，文章给理由 —— 两处说法打架比不写更伤信任。
// ★ 竞品结论只写**可核实的事实**（是否同步到原生书签栏、是否要自建服务、
//   是否开源、免费档形态）。不写「更好/更差」这类主观评价，也不写对方的价格
//   数字（会过期，且与我们无对比意义）。
// ★ 每个单元格的注记都是**双语对象**，不是裸字符串：英文页出现中文注记
//   （2026-10 首版就是这样）比不写注记更糟 —— 等于告诉英文访客「这页是机翻的」。

/** 双语字符串。表里所有人类可读文本都走这个类型，漏翻会在编译期报错。 */
export type I18nText = { zh: string; en: string };

export type CompareValue =
  | { kind: 'yes'; note?: I18nText }
  | { kind: 'partial'; note: I18nText }
  | { kind: 'no'; note?: I18nText }
  /** 这一维度对该产品不适用（如「同步引擎的合并语义」对纯管理器没有意义）。
   *  不写这个的话只能硬填 ✗，读者会看出是在凑数。 */
  | { kind: 'na'; note: I18nText }
  | { kind: 'text'; text: I18nText };

export type CompareRow = {
  /** 维度名（行首） */
  label: I18nText;
  /** 每个产品在该维度下的取值，顺序与 COMPARE_PRODUCTS 一致 */
  cells: CompareValue[];
};

export type CompareProduct = {
  key: string;
  name: string;
  /** 一句话定位，显示在表头下方 */
  tagline: I18nText;
  /** 本产品列高亮 */
  self?: boolean;
};

const bi = (zh: string, en: string): I18nText => ({ zh, en });

export const COMPARE_PRODUCTS: CompareProduct[] = [
  {
    key: 'bookmarksync',
    name: 'BookmarkSync',
    tagline: bi('跨浏览器原生书签同步', 'Native cross-browser bookmark sync'),
    self: true,
  },
  {
    key: 'floccus',
    name: 'Floccus',
    tagline: bi('开源同步扩展', 'Open-source sync extension'),
  },
  {
    key: 'xbrowsersync',
    name: 'XBrowserSync',
    tagline: bi('开源自建同步', 'Open-source, self-hosted'),
  },
  {
    key: 'raindrop',
    name: 'Raindrop.io',
    tagline: bi('云端书签管理器', 'Cloud bookmark manager'),
  },
  {
    key: 'cubox',
    name: 'Cubox',
    tagline: bi('稍后阅读 + 书签管理', 'Read-later + bookmark manager'),
  },
];

const yes = (note?: I18nText): CompareValue => (note ? { kind: 'yes', note } : { kind: 'yes' });
const partial = (note: I18nText): CompareValue => ({ kind: 'partial', note });
const no = (note?: I18nText): CompareValue => (note ? { kind: 'no', note } : { kind: 'no' });
const na = (note: I18nText): CompareValue => ({ kind: 'na', note });
const text = (t: I18nText): CompareValue => ({ kind: 'text', text: t });

const OWN_PANEL = bi('自有面板', 'own panel');
const VIA_PANEL = bi('经面板中转', 'via its panel');
const NOT_A_SYNC_TOOL = bi('不做同步', 'not a sync tool');

// ★ 判据：宁可把竞品写强一点，也不要靠贬低对手来突出自己。
//   竞品能做到的（Floccus / XBrowserSync 的真树同步与合并）照实写 ✓，
//   差异只在「要不要自建服务器」「E2EE 是否默认开」「顺序」「多空间」这些
//   可核实的事实上。一张处处打勾的假表，读者一眼就看穿。
export const COMPARE_ROWS: CompareRow[] = [
  {
    label: bi('同步到原生书签栏', 'Syncs to the native bookmarks bar'),
    cells: [yes(), yes(), yes(), no(OWN_PANEL), no(OWN_PANEL)],
  },
  {
    label: bi('Chrome ↔ Edge ↔ Firefox', 'Chrome ↔ Edge ↔ Firefox'),
    cells: [yes(), yes(), yes(), partial(VIA_PANEL), partial(VIA_PANEL)],
  },
  {
    label: bi('无需自建服务器', 'No server to run yourself'),
    cells: [
      yes(),
      no(bi('需 WebDAV / Nextcloud', 'needs WebDAV / Nextcloud')),
      no(bi('需自建同步服务', 'needs a self-hosted sync server')),
      yes(),
      yes(),
    ],
  },
  {
    label: bi('端到端加密', 'End-to-end encryption'),
    cells: [
      yes(bi('默认开启', 'on by default')),
      partial(bi('需手动设口令', 'set a passphrase manually')),
      yes(bi('默认开启', 'on by default')),
      partial(bi('非 E2EE', 'not E2EE')),
      partial(bi('非 E2EE', 'not E2EE')),
    ],
  },
  {
    label: bi('真树结构，改名/移动不丢子项', 'True tree — renames never drop children'),
    cells: [yes(), yes(), yes(), na(NOT_A_SYNC_TOOL), na(NOT_A_SYNC_TOOL)],
  },
  {
    label: bi('删除精准传播、不会复活', 'Deletes propagate and never resurrect'),
    cells: [yes(), yes(), yes(), na(NOT_A_SYNC_TOOL), na(NOT_A_SYNC_TOOL)],
  },
  {
    label: bi('多端并发合并、互不覆盖', 'Concurrent edits merge without overwriting'),
    // ★ Floccus 这格原先是 ✓，2026-10 读源码后降级（判据见
    //   src/lib/strategies/Default.ts:625 与 :1488）：并发 UPDATE 时
    //   「master 侧（本地）优先」，远端那次修改被静默丢弃。它不弹窗、
    //   不报错，但「两边都保留」不成立，所以只能是 △。
    cells: [
      yes(),
      partial(bi('master 侧优先', 'master side wins')),
      no(bi('整树覆盖', 'whole-tree overwrite')),
      na(NOT_A_SYNC_TOOL),
      na(NOT_A_SYNC_TOOL),
    ],
  },
  {
    // ★ 这一行是**正向表述**（✓ = 好），和其他行保持同一阅读方向。
    //   写成「需要人工介入」的话，我们这列的 ✗ 会被误读成「我们不支持」——
    //   整张表的 ✓ 语义就乱了。
    label: bi('冲突全自动收敛，无需人工处理', 'Conflicts resolve automatically — no manual work'),
    cells: [
      yes(bi('无需任何操作', 'no action needed')),
      partial(bi('保险丝可中止同步', 'failsafe may halt the sync')),
      no(bi('改动被覆盖，需重做', 'edits overwritten, redo required')),
      na(NOT_A_SYNC_TOOL),
      na(NOT_A_SYNC_TOOL),
    ],
  },
  {
    label: bi('书签顺序跨设备保持', 'Order preserved across devices'),
    cells: [
      yes(),
      no(bi('已知问题', 'known issue')),
      yes(),
      na(NOT_A_SYNC_TOOL),
      na(NOT_A_SYNC_TOOL),
    ],
  },
  {
    label: bi('多空间隔离（工作 / 生活）', 'Isolated spaces (work / personal)'),
    cells: [yes(), no(), no(), no(), no()],
  },
  {
    label: bi('免费档', 'Free tier'),
    cells: [
      text(bi('1,000 条永久免费', '1,000 bookmarks, free forever')),
      text(bi('免费，但服务器自付', 'free, but you pay for the server')),
      text(bi('免费，需自建服务器', 'free, but you self-host')),
      text(bi('免费增值', 'freemium')),
      text(bi('付费', 'paid')),
    ],
  },
];

/** 「查看详情」按钮目标（与文章 slug 同源，改文章路径时只改这里）。 */
export const COMPARE_DETAIL_PATH = '/explain/bookmark-sync-vs-alternatives';
