/**
 * 内容清单 —— **构建期自动生成的产物，请勿手改。**
 *
 * 由 src/seo/vite-plugin.js 在 closeBundle 时根据 content/{zh,en}/*.md 重新生成。
 * 为什么要提交进 git 而不是运行时读 fs：
 *   ★ 客户端（CSR）也要import 它来展开路由，而浏览器里没有 fs。
 *   两端必须看到**同一份**路由表，否则 SSR 渲染出的 DOM 与客户端期望的路由不匹配
 *   → hydration 报错或内容页 404。
 *
 * 手改会被下次构建覆盖。要新增文章，改 content/{zh,en}/ 下的 md 即可，
 * 路由 / sitemap / hreflang 会自动跟上。
 */

/** [{ locale, slug, prefix, category }] */
export const CONTENT_ROUTES = [
  {
    "locale": "zh",
    "slug": "folder-rename-loses-children",
    "prefix": "fix",
    "category": "fix",
    "title": "文件夹改名后子项全丢：为什么会发生，以及怎么避免",
    "seoTitle": "文件夹改名后子项消失丢书签 · BookmarkSync",
    "description": "改名或移动一个文件夹后，里面几百条书签「蒸发」，多半是书签被当成路径字符串而不是独立节点。这个根因只有一个解法。",
    "order": 1
  },
  {
    "locale": "en",
    "slug": "folder-rename-loses-children",
    "prefix": "fix",
    "category": "fix",
    "title": "Folder Renamed, Children Gone: Why It Happens and How to Avoid It",
    "seoTitle": "Folder Rename Loses Children · BookmarkSync",
    "description": "Rename or move a folder and hundreds of child bookmarks vanish. The cause is almost always bookmarks being stored as path strings instead of independent nodes — and there is only one real fix.",
    "order": 1
  },
  {
    "locale": "zh",
    "slug": "forgot-sync-passphrase",
    "prefix": "fix",
    "category": "fix",
    "title": "忘记同步口令，书签能救回来吗",
    "seoTitle": "忘记同步口令书签能恢复吗 · BookmarkSync",
    "description": "端到端加密的同步口令忘了，服务端也救不了——这不是产品缺陷，是加密的代价。这篇讲清能做什么、不能做什么，以及怎么在忘记之前就留好退路。",
    "order": 2
  },
  {
    "locale": "en",
    "slug": "forgot-sync-passphrase",
    "prefix": "fix",
    "category": "fix",
    "title": "Forgot Your Sync Passphrase: Can Your Bookmarks Be Recovered",
    "seoTitle": "Forgot Sync Passphrase, Can Bookmarks Be Recovered? · BookmarkSync",
    "description": "With end-to-end encryption, a forgotten sync passphrase means your data can never be decrypted — by anyone. That's the cost of encryption, not a product defect. Here's what you can do now so you never face that.",
    "order": 2
  },
  {
    "locale": "zh",
    "slug": "deleted-bookmarks-reappear",
    "prefix": "fix",
    "category": "fix",
    "title": "删掉的书签又冒出来了：删除同步的原理与四种修法",
    "seoTitle": "删掉的书签又回来了怎么解决 · BookmarkSync",
    "description": "在 A 电脑删掉的书签，在 B 电脑同步后又出现了——这不是同步失败，是删除没有被正确传播。这篇讲清删除同步的四种实现，以及怎么判断你用的是哪一种。",
    "order": 3
  },
  {
    "locale": "en",
    "slug": "deleted-bookmarks-reappear",
    "prefix": "fix",
    "category": "fix",
    "title": "Deleted Bookmarks Keep Coming Back: How Deletion Syncs and Four Ways to Fix It",
    "seoTitle": "Deleted Bookmarks Keep Reappearing · BookmarkSync",
    "description": "You delete bookmarks on machine A and they reappear on machine B after syncing. That's not a sync failure — it's deletion failing to propagate. Here's how deletion sync works and how to tell which implementation you have.",
    "order": 3
  },
  {
    "locale": "zh",
    "slug": "merge-conflict-two-devices",
    "prefix": "fix",
    "category": "fix",
    "title": "两台设备同时改书签：合并冲突的四种处理方式和各自的代价",
    "seoTitle": "多设备书签合并冲突 · BookmarkSync",
    "description": "公司电脑新加了 30 条书签，回家笔记本上同步后这30 条不见了。这是合并冲突，根因是同步引擎用哪种方式裁决「两边都改了」。四种处理方式里只有一种能保证两边都不丢。",
    "order": 4
  },
  {
    "locale": "en",
    "slug": "merge-conflict-two-devices",
    "prefix": "fix",
    "category": "fix",
    "title": "Two Devices Edited the Same Bookmarks: Four Merge Strategies and What Each Costs",
    "seoTitle": "Bookmark Merge Conflicts Explained · BookmarkSync",
    "description": "You added 30 bookmarks at the office, synced at home, and the 30 were gone. This is a merge conflict. The root cause is which strategy your engine uses to arbitrate \"both sides changed\" — and only one of the four can guarantee nothing is lost.",
    "order": 4
  },
  {
    "locale": "zh",
    "slug": "firefox-sync-bookmarks-mixed-up",
    "prefix": "fix",
    "category": "fix",
    "title": "Firefox 同步后书签全挤在一处：树被打散的根因是「合并」模型",
    "seoTitle": "Firefox 同步书签结构错乱 · BookmarkSync",
    "description": "Firefox 同步后 3000 条书签的树被打散、同一文件夹的书签全被合并进一个文件夹、新笔记本同步后子文件夹变空。根因不在操作，在于书签树节点不携带同步来源信息，而 Firefox Sync 用的是合并模型。",
    "order": 5
  },
  {
    "locale": "en",
    "slug": "firefox-sync-bookmarks-mixed-up",
    "prefix": "fix",
    "category": "fix",
    "title": "Firefox Sync Squashed All Your Bookmarks Into One Folder",
    "seoTitle": "Firefox Sync Mangled My Bookmark Tree · BookmarkSync",
    "description": "After Firefox sync, 3,000 bookmarks collapse into a single folder and subfolders come back empty. The root cause isn't anything you did — bookmark tree nodes carry no sync provenance, and Firefox Sync uses a merge model.",
    "order": 5
  },
  {
    "locale": "zh",
    "slug": "bookmarks-not-syncing-troubleshooting",
    "prefix": "fix",
    "category": "fix",
    "title": "书签同步不生效：按顺序排查的完整清单（含限流与配额）",
    "seoTitle": "书签同步不生效排查 · BookmarkSync",
    "description": "书签同步不生效、状态一直显示 scheduled、同步时好时坏。这篇是按执行顺序排的排查手册：先分清状态含义，再排除账号，再查配额和限流，最后才动本地数据。",
    "order": 6
  },
  {
    "locale": "en",
    "slug": "bookmarks-not-syncing-troubleshooting",
    "prefix": "fix",
    "category": "fix",
    "title": "Bookmark Sync Not Working: A Troubleshooting Checklist in Order",
    "seoTitle": "Bookmark Sync Not Working · BookmarkSync",
    "description": "Sync does nothing, the status stays on scheduled, or it works half the time. This is a runbook, not a list of causes: check status meaning first, then account, then quota and rate limits, and only then touch local data.",
    "order": 6
  },
  {
    "locale": "zh",
    "slug": "chrome-to-firefox-bookmarks",
    "prefix": "migrate",
    "category": "migrate",
    "title": "Chrome 书签迁移到 Firefox：会丢什么，以及怎么正确迁",
    "seoTitle": "Chrome 书签迁移到 Firefox · BookmarkSync",
    "description": "把 Chrome 书签搬到 Firefox，空的中间层文件夹会消失、Chrome 账号子树会落到「其他书签」。这是迁移前必须知道的四件事，以及两条迁移路径的取舍。",
    "order": 7
  },
  {
    "locale": "en",
    "slug": "chrome-to-firefox-bookmarks",
    "prefix": "migrate",
    "category": "migrate",
    "title": "Migrating Bookmarks from Chrome to Firefox: What You Lose and How to Do It Right",
    "seoTitle": "Chrome to Firefox Bookmark Migration · BookmarkSync",
    "description": "Moving Chrome bookmarks to Firefox flattens empty intermediate folders and lands your Chrome account subtree under Other Bookmarks. Four unavoidable limits, two migration paths, and how to verify the result.",
    "order": 7
  },
  {
    "locale": "zh",
    "slug": "safari-to-chrome-bookmarks",
    "prefix": "migrate",
    "category": "migrate",
    "title": "Safari 书签迁移到 Chrome：会丢什么，最快的路径是哪条",
    "seoTitle": "Safari 书签迁移到 Chrome · BookmarkSync",
    "description": "Safari 书签存在二进制的 Bookmarks.plist 里，但首选路径不是导文件——是 Apple 官方的 iCloud Bookmarks 扩展。这篇讲清阅读列表和智能文件夹会丢、书签顺序不导出，以及 Chrome 侧的真实代价。",
    "order": 8
  },
  {
    "locale": "en",
    "slug": "safari-to-chrome-bookmarks",
    "prefix": "migrate",
    "category": "migrate",
    "title": "Safari Bookmarks to Chrome: What You Lose and the Fastest Path",
    "seoTitle": "Safari Bookmarks to Chrome · BookmarkSync",
    "description": "Safari's bookmarks live in a binary plist, but the fastest path isn't a file export — it's Apple's official iCloud Bookmarks extension. What Reader and Smart Folders lose, why order doesn't export, and Chrome's real cost.",
    "order": 8
  },
  {
    "locale": "zh",
    "slug": "edge-to-chrome-bookmarks",
    "prefix": "migrate",
    "category": "migrate",
    "title": "Edge 收藏夹并入 Chrome：最简单的迁移，和「删掉又冒出来」那个问题",
    "seoTitle": "Edge 收藏夹导入 Chrome · BookmarkSync",
    "description": "Edge 和 Chrome 都是 Chromium 内核，书签格式完全兼容，迁移成本最低。这篇讲清哪些能带走、哪些带不走（集、edge://favorites 路径），以及收藏夹删掉又冒出来的原因。",
    "order": 9
  },
  {
    "locale": "en",
    "slug": "edge-to-chrome-bookmarks",
    "prefix": "migrate",
    "category": "migrate",
    "title": "Merging Edge Favorites into Chrome: The Easy Migration and the Duplicates Problem",
    "seoTitle": "Edge Favorites to Chrome · BookmarkSync",
    "description": "Edge and Chrome share the Chromium engine and a fully compatible bookmark format, making this the cheapest migration there is. What carries over, what doesn't (Collections, edge:// paths), and why deleted favorites come back.",
    "order": 9
  },
  {
    "locale": "zh",
    "slug": "how-to-verify-e2ee-bookmark-sync",
    "prefix": "explain",
    "category": "explain",
    "title": "怎么判断一个书签同步扩展是真端到端加密：一份检查清单",
    "seoTitle": "真端到端加密怎么判断 · BookmarkSync",
    "description": "「我们支持端到端加密」这句话几乎没有信息量。这份清单列出七个可以自己动手验证的判据：密码重置流程、网页预览、算法名、密钥派生迭代、审计、开源，以及最关键的一条——他们能不能给你发重置主密码的邮件。",
    "order": 10
  },
  {
    "locale": "en",
    "slug": "how-to-verify-e2ee-bookmark-sync",
    "prefix": "explain",
    "category": "explain",
    "title": "How to Tell If a Bookmark Sync Extension Is Actually End-to-End Encrypted",
    "seoTitle": "Is It Really E2EE? A Checklist · BookmarkSync",
    "description": "\"We support end-to-end encryption\" carries almost no information — plaintext storage can say it too. Here are seven criteria you can verify yourself, starting with the strongest one: whether the vendor can email you a link to reset your master password.",
    "order": 10
  }
];

/** 内容文章的分类定义（与 src/content/index.js 的 CATEGORIES 保持一致）。 */
export const CONTENT_CATEGORIES = {
  fix: {
    prefix: "fix",
    label: {"zh":"问题解决","en":"Troubleshooting"},
    description: {"zh":"书签被改名后子项消失、删掉的又冒出来、多设备合并打架——这些是浏览器同步最常见的故障，这里逐个讲清原因和做法。","en":"Children vanishing after a folder rename, deleted bookmarks coming back, merges fighting each other — the most common bookmark sync failures, explained one by one."},
  },
  migrate: {
    prefix: "migrate",
    label: {"zh":"跨浏览器迁移","en":"Migration"},
    description: {"zh":"从 Chrome 换到 Firefox、Safari 书签搬到 Chrome、Edge 合并进 Chrome——含实测的迁移路径与「哪些操作会丢结构」的诚实提醒。","en":"Chrome to Firefox, Safari to Chrome, merging Edge into Chrome — with tested paths and honest warnings about what loses structure."},
  },
  explain: {
    prefix: "explain",
    label: {"zh":"原理与判断","en":"How it works"},
    description: {"zh":"端到端加密到底意味着什么、删除是怎么传播的、多设备冲突怎么收敛——判断一个书签同步工具该不该信的检查清单。","en":"What end-to-end encryption actually means, how deletions propagate, how conflicts converge — a checklist for judging whether a bookmark sync tool deserves trust."},
  },
};
