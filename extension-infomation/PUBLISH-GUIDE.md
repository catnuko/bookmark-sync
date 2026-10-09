# 投放说明：article-zh.md / article-en.md 用法

> 生成日期：2026-10-09 ｜ 对应产品版本：Bookmark Sync v2.10.1
> 素材性质：两篇正文均为**事实型长文**，不含促销话术、可直接全稿发布。

## 一、文件清单

| 文件 | 用途 | 目标渠道 |
|---|---|---|
| `article-zh.md` | 中文版，3600 字 | 知乎回答/文章、公众号、V2EX、少数派、Chrome 扩展中文社区 |
| `article-en.md` | 英文版，2600 词 | Reddit（r/chrome, r/firefox, r/privacy）、Medium、Dev.to、Hacker News、Product Hunt |
| `README.md` | 商店上架文案（既有文件，未改动） | Chrome/Edge/AMO 后台 |

## 二、知乎版投放要点

1. **不要投「专栏文章」，投「回答」**。知乎回答的搜索权重高于专栏文章，且会被百度与必应收录。操作：在相关问题下回答，正文粘贴全文。
2. **推荐回答的问题（按流量排序）**
   - 「Chrome 和 Firefox 的书签怎么互通？」
   - 「浏览器书签同步有哪些方案？」
   - 「Chrome 书签怎么导出到 Firefox？」
   - 「书签太多太乱怎么整理？」
   - 「有哪些好用的 Chrome 扩展推荐？」
3. **首图用 `store-assets/1280x800/` 里的图**，从图里能看见真实书签树（比 logo 更可信）。
4. **知乎忌硬广**。正文中产品出现 3–4 次即可，其余篇幅讲原理与方案对比。硬广会被折叠且降低账号权重。
5. **文末留一个明确动作**：官网 + 三家商店链接（本文件第五节），其余不动。
6. **评论区维护**：上线后前两周内尽量每条评论都回，回复本身也会被搜索。

## 三、公众号版投放要点

1. 公众号正文不参与百度收录（微信域被屏蔽），**主要价值是转发与信任背书**，不要指望搜索流量。
2. 建议做**两篇拆分**，一次发完太长：
   - 上篇：《为什么浏览器自带的书签同步救不了你》
   - 下篇：《书签同步的分歧点：同步路径，还是同步节点》
3. **标题不要带产品名**。公众号打开率靠悬念，产品名放正文首屏第二段。
4. 排版：知乎版里的 Markdown 表格在公众号编辑器里粘不进去，**转成图片或改用列表**。
5. 结尾引导：「回复关键词 **书签** 获取安装链接」比直接放链接转化更高。

## 四、Reddit / 海外社区投放要点

Reddit 对自我推广极敏感，**硬发必被 downvote**。有效做法：

1. 先在 r/firefox、r/chrome 的**求助帖**里以「我遇到了 X 问题，做了 Y」的经历角度回答，末尾自然提及产品，**不放链接**（Reddit 会自动移除外链）。
2. r/selfhosted、r/privacy 这类社区对「端到端加密 + 自持数据」敏感，是最合适的语境，但仍需先建立参与度。
3. Product Hunt 发布时 tagline 用：`Cross-browser bookmark sync with end-to-end encryption. One tree across Chrome, Edge, and Firefox.`（与商店文案一致，利于搜索一致性）。
4. Medium / Dev.to 适合放**英文版全文**，并在文末标注开源仓库（GitHub 链接是权重最高的引用源）。

## 五、统一物料（各渠道复用，不要改动）

| 渠道 | 链接 |
|---|---|
| 官网 | https://www.bookmark-sync.top |
| Chrome Web Store | https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml |
| Edge Add-ons | https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah |
| Firefox AMO | https://addons.mozilla.org/firefox/addon/bookmark-sync-app |
| 开源仓库 | https://github.com/catnuko/bookmark-sync |
| 隐私政策 | https://www.bookmark-sync.top/privacy |
| 支持邮箱 | support@bookmark-sync.top |

**链接一致性是 SEO 的隐性资产**：五处渠道用同一套 URL，搜索引擎会把它们识别为同一实体，跨域引用互相加权。**不要在任何渠道加追踪参数**。

## 六、覆盖的搜索意图（正文中已自然埋入）

| 意图 | 文中对应段落 |
|---|---|
| 跨浏览器书签怎么同步 | 第一节（问题定义） |
| Chrome 书签导入 Firefox | 第六节（浏览器支持）+ 商店链接 |
| 书签同步会不会丢 / 删除复活 | 第三节（墓碑） |
| 书签同步安全吗 / 服务端能看到什么 | 第四节（E2EE + 权限清单） |
| 书签太多怎么整理 / 分类 | 第七节（多空间） |
| 免费书签同步扩展推荐 | 第一节对比表 + 第八节定价 |

## 七、更新纪律

产品发新版本后，**只改这两篇里的版本号与差异段落，不要重写全文**——已被搜索引擎收录的段落 URL 结构一旦大改，排名会掉。

需要改的位置：
1. 文首「版本口径」一行；
2. 第八节价格表（若调价）；
3. 文末「本文更新记录」表格**追加一行**，不要删旧行；
4. 若新增功能，在第十节「适合谁」中加一条，不要插入新的一级章节。

## 八、注意事项

- 文中「约 25 万条封顶」是**按 500 MB ÷ 2 KB 折算**得出的，不是官方承诺，文末「数据口径说明」已标注。对外发布时**保留这段标注**，否则有夸大宣传风险。
- 加密参数（PBKDF2 210,000 次迭代等）来自源码，属于可被验证的技术事实，**比任何宣传语都更有说服力，务必保留**。
- Safari 不支持是平台限制（无 `bookmarks` API），如实写比含糊写更能建立信任。
- 文章不含用户评价、不含安装量、不含排名承诺——这三类内容一旦被编造，是账号被封的典型原因。
