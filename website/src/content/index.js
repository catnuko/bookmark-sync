/**
 * 内容目录 —— 长尾内容的**唯一来源**。
 *
 * 为什么不引第三方 markdown 库：
 *   我们需要的语法子集很小（标题/段落/列表/表格/代码/引用/FAQ），marked + gray-matter
 *   两个依赖换来的功能大部分用不上，而且它们在 SSG 里要多一层「把 md 变 HTML 再塞进 vnode」
 *   的处理，反而比直接产出结构化 AST 麻烦。
 *   ★ 判据：**引入新依赖必须换来省下的代码量**。这里不划算。
 *
 * 文件格式：frontmatter + markdown 子集（见 content/parse.js 的 SUPPORTED 注释）。
 * 命名：`<locale>/<slug>.md`，如 `content/zh/folder-rename-loses-children.md`。
 *
 * ★ 新增一篇内容要改三处（都在本文件能查出来）：
 *   1. 本目录加 md 文件
 *   2. seo/content-seo.js 加该 slug 的 title/description/keywords
 *   3. content/index.js 的 CATEGORIES 里归类（决定它出现在哪个索引页）
 */
export const CONTENT_DIR = 'content';

/** 内容分类 —— 决定文章的 URL 前缀与索引页归属。 */
export const CATEGORIES = {
  /** 「我的书签出问题了」—— 转化意图最强，对应研究里的问题/故障类关键词 */
  fix: {
    prefix: 'fix',
    label: { zh: '问题解决', en: 'Troubleshooting' },
    tocLabel: { zh: '本文目录', en: 'On this page' },
    relatedLabel: { zh: '相关问题', en: 'Related' },
    cta: { zh: '这些问题的解法，都来自同一套同步引擎', en: 'One sync engine handles all of these' },
    ctaLabel: { zh: '免费安装', en: 'Install free' },
    ctaSecondary: { zh: '查看定价', en: 'See pricing' },
    description: {
      zh: '书签被改名后子项消失、删掉的又冒出来、多设备合并打架——这些是浏览器同步最常见的故障，这里逐个讲清原因和做法。',
      en: 'Children vanishing after a folder rename, deleted bookmarks coming back, merges fighting each other — the most common bookmark sync failures, explained one by one.',
    },
  },
  /** 「从 X 换到 Y」—— 迁移类关键词，需求量大 */
  migrate: {
    prefix: 'migrate',
    label: { zh: '跨浏览器迁移', en: 'Migration' },
    tocLabel: { zh: '本文目录', en: 'On this page' },
    relatedLabel: { zh: '其他迁移指南', en: 'Other guides' },
    cta: { zh: '搬完这一次，之后不用再搬', en: 'Migrate once, not every device change' },
    ctaLabel: { zh: '免费安装', en: 'Install free' },
    ctaSecondary: { zh: '查看定价', en: 'See pricing' },
    description: {
      zh: '从 Chrome 换到 Firefox、Safari 书签搬到 Chrome、Edge 合并进 Chrome——含实测的迁移路径与「哪些操作会丢结构」的诚实提醒。',
      en: 'Chrome to Firefox, Safari to Chrome, merging Edge into Chrome — with tested paths and honest warnings about what loses structure.',
    },
  },
  /** 原理与判断 —— 建立技术信任，承接「怎么验证是不是真 E2EE」这类词 */
  explain: {
    prefix: 'explain',
    label: { zh: '原理与判断', en: 'How it works' },
    tocLabel: { zh: '本文目录', en: 'On this page' },
    relatedLabel: { zh: '继续了解', en: 'Read next' },
    cta: { zh: '看完原理，不妨自己试一次', en: 'Now that you know how it works, try it' },
    ctaLabel: { zh: '免费安装', en: 'Install free' },
    ctaSecondary: { zh: '查看定价', en: 'See pricing' },
    description: {
      zh: '端到端加密到底意味着什么、删除是怎么传播的、多设备冲突怎么收敛——判断一个书签同步工具该不该信的检查清单。',
      en: 'What end-to-end encryption actually means, how deletions propagate, how conflicts converge — a checklist for judging whether a bookmark sync tool deserves trust.',
    },
  },
};
