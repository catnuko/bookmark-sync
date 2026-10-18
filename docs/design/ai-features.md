# AI 功能设计说明（面向维护者）

> 读者：**后续改 `src/ai/` 或相关 pane 的开发/维护 agent**。不是用户手册 —— 用户看到的文案与操作步骤见官网与 `docs/manual-test-plan.md`。
>
> 真相在源码注释里。本文只把散在 10 个模块文件头的决策提炼成一份可索引的全貌，每条论断都给了 `file:line`。与 `AGENTS.md`「AI 功能 = BYOK 与三条硬护栏」一节互补：那节讲**不可回退的纪律**，这节讲**系统怎么拼起来**。
>
> 最后更新：2026-10-18（分支 `feat-ai-options`，评估修复 `3f6f85d` / `b61b386` / `454d8ac` 之后）。

---

## 1. 功能清单

六项功能，全部在 options 设置页（`OptionsView.vue:96-103` 的 `panes` 数组是真源），popup 只给「整理书签」一个直达入口。

| 功能            | pane 组件                                           | 一句话职责                                                    | 是否碰模型 | 是否写书签树             |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------- | ---------- | ------------------------ |
| AI 配置（BYOK） | `PaneAI.vue`                                        | 多 provider 列表 + 各自 key + 总开关 + 连通性测试 + host 授权 | 测试时     | 否                       |
| 书签问答        | `PaneAIChat.vue` + `ui/ChatPanel.vue`               | 本地检索 top-N 候选 → 流式问答，候选之外的书签不外发          | 是（流式） | 否                       |
| 整理书签        | `PaneOrganize.vue`                                  | 批量归类（选范围→出方案→确认→落地）+ 精确去重 + 语义判重      | 归类/语义  | 是（move/create/update） |
| 链接体检        | `PaneLinkCheck.vue`                                 | 批量探活（5 态）→ AI 修复建议 → 采纳（改 URL）/撤销           | 建议阶段   | 是（仅 update URL）      |
| 健康洞察        | `PaneHealth.vue`                                    | 四张本地统计卡（沉睡/重复/空文件夹/失效）+ AI 文字总结        | 仅总结     | 否                       |
| 地址栏搜索      | `PaneOmnibox.vue`（说明页）+ `src/omnibox.ts`（SW） | 地址栏 `bs` + 空格，本地关键词打分出建议项                    | **否**     | 否                       |

入口细节：

- **AI 配置**是设置页第 1 个 pane（`PaneAI.vue:253`）。列表形态（2026-10-06 起）：每条 provider 独立 baseUrl/model/key，`id` 用本地随机串而非厂商名 —— 同一厂商可加两条（官方 + 中转）（`PaneAI.vue:255-268`、`config.ts:57-71`）。
- **整理书签**是 popup 唯一直达的 AI 页：popup 行文案 `popup_settingsRow` = 「整理书签」，`openSettingsPage()` 先写 `storage.session` 的 `options.pane='organize'` 再 `openOptionsPage()`（`PopupView.vue:162-185`）。这条链路的事故与守卫见 §5、§6。
- **地址栏搜索**没有可操作控件 —— 建议项由浏览器原生渲染，所以这个 pane 是设计规格说明 + 用法引导（`PaneOmnibox.vue:102-110`）；真正的检索在 SW 顶层 `registerOmnibox()`（`background.ts:18,89-91`），复用 `ai/qa.ts` 的 `searchBookmarks`（`omnibox.ts:1-15`）。
- **精确去重不依赖 AI**：`dedupe.ts` 是确定性字符串处理，零网络零 token（`dedupe.ts:2-9`）。所以 PaneOrganize 的 AI gate 只挡真正依赖模型的归类/语义那两块，不整页拦下（`PaneOrganize.vue:354-358`）。

### 关键数据出口（哪些内容会离开本机）

| 功能         | 发给模型的内容                                           | 源码依据                    |
| ------------ | -------------------------------------------------------- | --------------------------- |
| 归类         | 每批 60 条的 `(编号, 标题(截120), 域名)` + 现有文件夹名  | `classify.ts:28-33,180-193` |
| 语义判重     | 本地倒排索引挑出的「共享稀有词」候选对（几十~几百对）    | `semanticDedupe.ts:13-20`   |
| 问答         | 本地打分 top-40 候选（标题/URL/路径），非整棵树          | `qa.ts:1-20,37`             |
| 链接修复建议 | **只发 broken 项**，不发 unknown（反爬挡的模型也猜不准） | `linkCheck.ts:264-271`      |
| 健康总结     | **只有几个聚合数字，没有一条书签标题或 URL**             | `health.ts:5-13`            |
| 地址栏       | 无（纯本地）                                             | `omnibox.ts:10-14`          |

---

## 2. 数据流图

```
                         ┌─────────────────────────────────────────┐
  用户在 options 页操作   │  chrome.storage.local                    │
  ─────────────────────► │   ai.providers / ai.activeId / ai.keys   │
                         │   ai.migrated{enabled}   ← key 与配置分离 │
                         └───────┬───────────────────────┬──────────┘
                                 │ readAiConfig()        │ readApiKey()
                                 ▼                       ▼
                        ┌─────────────────┐    ┌──────────────────┐
                        │ AiConfig        │    │ apiKey           │
                        │ provider/baseUrl│    │ （只在本机内存）  │
                        │ /model（无 key） │    └────────┬─────────┘
                        └────────┬────────┘             │
                                 └──────────┬───────────┘
                                            ▼
              ┌──────────────────────────────────────────────────────┐
              │ provider.ts  complete() / streamComplete()            │
              │  buildRequest(): anthropic→/v1/messages + 独立 system │
              │                  其余→/v1/chat/completions + Bearer   │
              │  fetch 直连用户端点（不经我们的服务器）                │
              │  AbortError 原样透传 ≠ 失败；isCorsBlocked()→引导授权  │
              └───────────────┬──────────────────┬───────────────────┘
                       非流式 JSON │                │ 流式文本块（问答/健康总结）
                              ▼    │                ▼
              ┌──────────────────┐ │   ┌──────────────────────┐
              │ extractJson() 兜底│ │   │ 逐块追加到最后一条消息 │
              │ 围栏→首尾大括号    │ │   └──────────────────────┘
              └────────┬─────────┘ │
                       ▼           │
        ┌──────────────────────────┴───┐
        │ 归一化校验（模型输出不可信）    │  classify.normalizeGroups 四道过滤：
        │ 越界下标/重复/结构非法→丢弃     │  semanticDedupe / suggestRepairs 同理
        └────────┬─────────────────────┘
                 ▼
   ╔═══════════════════════════════════╗
   ║  ★ 用户显式确认（唯一的落地闸门）  ║  方案先完整渲染 → 勾选组 → 点「应用」
   ║  勾选 + 应用，绝不自动生效         ║  （organize.ts:4-10, classify.ts:34-38）
   ╚═══════════════┬═══════════════════╝
                   ▼
        ┌───────────────────────────┐
        │ applyPlan()               │ 阶段一建齐文件夹（parentId=scopeId）
        │  只 move / create / update │ 阶段二逐个 move（超 200 直接拒），可 shouldStop
        │  永不 remove/removeTree   │ 半程失败不回滚，已完成的保留
        └────────┬──────────────────┘
                ▼
   chrome.bookmarks.move / create 事件（不做事件抑制）
                ▼
   同步引擎正常捕获 → 产生 CRDT op → opCrypto AES-256-GCM 加密
                ▼
   用户点「立即同步」/ 自动轮次 → push 上云 → 传播到其它设备
                （这些移动是用户确认过的真实意图，就该同步出去 —— organize.ts:249-254）
```

撤销分支（独立于上行链路）：

```
 applyPlan 前记快照 snapshot = { moved:[{id,parentId,index}], createdFolders }
                │
   用户点「撤销移动」（仅本次会话内可点，快照只在内存 ref 里，见 §6）
                ▼
 revertApply(): 逆序 move 回 (parentId, index)；★ 不删 createdFolders
                （删文件夹 = onRemoved → 墓碑 → 跨设备删除，organize.ts:329-352）
```

---

## 3. 权限模型

默认态：**0 权限增量**。`bookmarks / storage / alarms` 是既有权限（`manifest.json:12`），AI 功能不新增任何必选权限。

### 3.1 host 权限（可选，`optional_host_permissions`）

- **为什么默认不需要**：Anthropic / OpenAI / DeepSeek / 智谱 / Ollama 都回 CORS 头，扩展页面直接 fetch 即可（`hostAccess.ts:4-7`）。Anthropic 额外带 `anthropic-dangerous-direct-browser-access: true` 才放开跨域 —— 该 header 的名字就是在警告「浏览器里放 key 有风险」，BYOK 场景下用户明知风险并主动填入，属官方认可的用法（`provider.ts:16-21,154-162`）。
- **什么时候需要**：自建 / 中转 / 内网端点不回 `Access-Control-Allow-Origin`，浏览器拦截，报 `TypeError: Failed to fetch`。`isCorsBlocked()` 按特征识别（`provider.ts:139-152`），UI 据此露出「授权访问」按钮（`PaneAI.vue:320-322`）。host 权限可绕过 CORS，所以申请该 origin 的权限是唯一出路。
- **两条硬约束**（违反 = 功能静默失效，`hostAccess.ts:16-26`）：
  1. `requestHostAccess()` / `requestBroadHostAccess()` 必须在用户手势内、且是 click handler 的**第一句** —— 任何前置 `await` 都会吃掉手势。`permissions.request()` 抛错（手势失效/非前台上下文）一律捕获后返回 false，不抛穿到 UI（`hostAccess.ts:60-76,118-132`）。
  2. manifest 必须先声明：`OPTIONAL_HOST_PATTERNS = ['https://*/*', 'http://*/*']` 与 `public/manifest.json:15` 逐字一致（护栏用例 `tests/ai/hostAccess.test.ts` 「★ 与 manifest 的 optional_host_permissions 逐字一致」）。不用 `<all_urls>`：不覆盖 file:// 与 ftp://，权限面小、审核好解释。
- **查询用匹配模式**：`permissions.contains/request` 传的是 `origin + '/*'` 而不是裸 origin（`hostAccess.ts:44-58`）；带端口同理。
- **两种粒度**：
  - `hasHostAccess(origin)` / `requestHostAccess(origin)` —— 单端点粒度，给自建 AI 网关用（PaneAI 的授权按钮）。
  - `hasBroadHostAccess()` / `requestBroadHostAccess()` —— 广域粒度（https+http 两条通配**全部**授予才算有），给链接体检用：没有广域权限时跨域 fetch 拿 opaque 响应（`status === 0`）读不到 404，探活等于白跑，所以「授权探活权限」是该功能的**前置步骤而非可选项**（`hostAccess.ts:98-132`、`linkCheck.ts:9-14`）。

### 3.2 history 权限（可选，`optional_permissions`）

- 只有健康洞察的「沉睡书签」需要读浏览历史。`history` 若写进必选 `permissions`，安装时就会弹「读取你的浏览记录」—— 劝退级权限，而多数用户根本不用沉睡统计，所以走 `optional_permissions`（`manifest.json:13`）+ 运行时申请（`lib/historyAccess.ts:4-9`）。
- 与 hostAccess 分模块：一个管 `origins`、一个管 `permissions`，混在一起会让「哪一步在要什么权限」难以追踪（`historyAccess.ts:11-15`）。同一条「手势第一句」约束（`historyAccess.ts:17-22`；PaneHealth 的调用点注释特意说明前面的 `if (historyGranted)` 是同步判断、不吃手势，所以安全 —— `PaneHealth.vue:260-265`）。
- 降级口径：未授权时 `sleeping = null` 而不是 0 —— 0 会被误读成「没有沉睡书签」，null 让 UI 显示「-- / 需历史权限」（`health.ts:27-31`）。

### 3.3 数据可见性矩阵（给权限审查/商店审核用）

| 数据                   | 离开本机？                                    |
| ---------------------- | --------------------------------------------- |
| API Key                | 否（storage.local，不发我们的服务器、不漫游） |
| 书签标题/URL（未筛）   | 否                                            |
| 候选/批次子集          | 是，直连**用户自己的**端点                    |
| 健康统计               | 只有聚合数字                                  |
| 我们的 Supabase 服务器 | 永远只看到密文 op                             |

---

## 4. 取消语义

三类长任务（归类、语义判重、AI 修复建议）+ 一个落地过程（applyPlan），取消语义刻意统一成 **「abort ≠ 失败」**：

- **signal 在批次边界检查**：`classifyBookmarks` / `classifySemanticDupes` / `suggestRepairs` 接可选 `signal: AbortSignal`，每批开跑前查 `signal?.aborted` —— 已完成的批次结果与 usage **保留**，未发起的批次不再发起，返回 `aborted: true`；整批失败/被取消的书签如实记入 `unclassified`，不猜不丢（`classify.ts:124-165`，另两个模块同款注释）。并发上限固定（归类/判重 3、修复建议 2），批间互不依赖，所以「只丢未发起的批」是准确的取消粒度（`classify.ts:91-92`、`classify.ts:274-294` 的 `mapLimit`）。
- **provider 层透传 AbortError**：`complete()` 里 `e.name === 'AbortError'` 必须原样 throw，绝不能包成 `AiError` —— 否则上层无法区分「主动取消」与「真失败」，一次本该静默的中断会被当失败统计/报错（`provider.ts:270-274`）。
- **applyPlan 用回调不用 signal**：落地是本地 API 调用（无 fetch 可 abort），所以走 `shouldStop()` 轮询，每个 create/move 前检查，点「停止」就停在已完成位置，**半程状态不回滚**（已成功的保留不回滚，比「全失败」更容易看懂 —— `organize.ts:99-107,236-327`；PaneOrganize 的停止按钮置标志位，`PaneOrganize.vue:521-545`）。
- **切页即中止**：`onBeforeUnmount` abort 掉在途的归类/判重 controller —— 否则 promise 跑完继续烧 token、把结果写进已不可见的组件（`PaneOrganize.vue:448-458`）。探活同理「关掉标签页 = 中止」（`linkCheck.ts:4-8`）。
- **回归护栏**：`tests/ai/abort.test.ts` 除行为用例外还有一个 `it.fails` **变异探针** —— 用去掉边界检查的源码副本生成临时模块，若将来有人删掉 `if (signal?.aborted)` 探针就报警，防止取消测试假通过（提交 `b61b386`，`tests/ai/abort.test.ts:277`）。

---

## 5. 导航与入口（popup → options 直达）

popup 与 options 是**两个独立 JS 上下文**，`state.navPane` 不共享；跨页传目标 pane 用 `chrome.storage.session`（不选 hash：popup 里不可靠；不选 local：跳转意图是会话级的，且 local 会漫游到别的设备）。读侧「用完即删」，避免下次手动打开设置页也落在整理书签、找不到 AI 配置入口（`PopupView.vue:167-185`）。

`OptionsView.vue` 的 onMounted 按三级优先级校正首屏 pane（`OptionsView.vue:125-140`，真源注释在文件里）：

```
1. state.navPane 合法（同页内用户已选过）→ 保留   ← 有意的短路
2. navPane 非法 → 兜底 panes[0]
3. storage.session 有 options.pane → 用它，并删除该键
```

★ **`store.ts` 的 `navPane` 初始值必须是非法 id（`''`）**。填成任何真实 pane id（曾填 `'ai'`）都会让分支 1 恒真、把 session 读取整段变死代码 —— 2026-10-18 实测事故：popup「整理书签」100% 落到 AI 配置页且无任何报错（`store.ts:187-201`）。回归：`tests/optionsNav.test.ts` 6 用例（含一条反证「初始值若是合法 id，popup 传来的 pane 会被完全忽略」）。

健康洞察的整理建议卡通过写 `state.navPane` 跨 pane 跳转（`PaneHealth.vue:318`，同页内、合法值，与上面 session 机制是两条独立路径）。

---

## 6. 已知限制（如实记录，勿当成 bug 重报）

1. **撤销快照只在内存，不落盘**。整理落地的快照存在 `PaneOrganize` 的 `result` ref 里（`PaneOrganize.vue:399,530`），链接修复的快照是组件级 `let lastSnapshot`（`PaneLinkCheck.vue:660-661`，注释原文「会话内快照，供撤销。不落盘 —— 关掉页面就没了（UI 上写明了）」）。**切页/关标签后再回来就无法撤销** —— 数据不会坏（位置就是位置），只是失去一键回退能力。持久快照意味着要在 storage 里存一批 chromeId，而 id 在别处被投影/重建后即失效，收益不抵复杂度，故刻意不做。
2. **撤销只还原位置**。不改标题（organize 不动 title）、不删新建文件夹、无法还原「文件夹被删」这类 apply 里根本不存在的操作 —— 护栏③的另一面（`organize.ts:22-27`）。空文件夹由用户自行处理。
3. **探活必须由常驻页面驱动，跑几分钟**。MV3 SW 约 30s 空闲即被回收，长任务放 SW 必然被腰斩且无法让它跑完，所以探活在 options 页跑、关页即中止，UI 在 idle 态就写明（`linkCheck.ts:4-8`、`PaneLinkCheck.vue:388-391`）。串行限速（间隔 ~400ms + 抖动、同 host 最小 1200ms）—— 并发几十个请求容易触发站点风控，反而让大量结果落进 unknown（`linkCheck.ts:64-68,185-200`）。
4. **unknown ≠ broken**。反爬、Cloudflare、403/429/5xx、超时、opaque 全部归 unknown；把它们标成「失效」会诱导用户误删好链接。失效判据只有 404/410（`linkCheck.ts:21-30,144-156`）。健康卡的「失效链接」不重跑探活，读上次落盘摘要（`ai.linkSummary`），没跑过显示「尚未检测」，不猜不编（`health.ts:15-20`）。
5. **没有组件级测试**。现有测试全是纯函数/模块级（`tests/ai/*.test.ts`），加上两条「编译真实 SFC 后执行」的窄覆盖（`tests/optionsNav.test.ts`、PaneOrganize 无）。pane 的状态机（如 PaneLinkCheck 的 unauthorized→idle→detecting→report→completed）靠 `docs/manual-test-plan.md` 的套件 I 手工验收。
6. **不重试、不遥测**。AI 是用户主动触发的，失败就如实报错，重试只会掩盖问题；明文和 key 都不出本机，也没有可统计的（`provider.ts:36-39`）。
7. **模型 id 有时效性**。默认表里的模型名换厂商前要查官方文档（DeepSeek `deepseek-chat` 已于 2026-07-24 弃用，填旧名直接 400，且表现更像「AI 不好用」而非明确报错 —— `provider.ts:53-62`）。
8. **prompt caching 只标 system**。归类任务里 system + 复用文件夹名那段每批完全相同，是最理想前缀（Anthropic 命中后输入价降约 90%，DeepSeek 命中价差 50 倍）；标到 user 消息上等于每批都是新前缀、永远不命中（`provider.ts:228-243`）。改动 system 拼装结构前先读这段。

---

## 7. 模块地图与测试对应

```
src/ai/
├── provider.ts   协议（anthropic / openai 兼容）、buildRequest、SSE、isCorsBlocked、extractJson
├── config.ts     storage.local 读写、多 provider 列表、key 分离、旧结构迁移、seedDevAiKey
├── hostAccess.ts host 权限（单 origin + 广域两粒度）      ← lib/historyAccess.ts 管 history 权限
├── classify.ts   批量归类调模型 + normalizeGroups 校验 + chunk/mapLimit（后两者被复用）
├── organize.ts   listFolders / planOrganize / applyPlan / revertApply   ★ 三条硬护栏
├── dedupe.ts     精确判重（纯本地，URL 规范化只删追踪参数）   ← 永不调模型、永不删除
├── semanticDedupe.ts 语义判重（本地候选生成 + 模型判定）      ← 只报告不删除
├── linkCheck.ts  探活（probeUrl/createLinkChecker）+ suggestRepairs + apply/revertRepairs
├── health.ts     collectHealth 四卡 + 摘要读写 + summarizeHealth（只有数字出本机）
└── qa.ts         tokenize/searchBookmarks 本地检索（被 omnibox.ts 复用）+ QA prompt
```

| 模块          | 测试                                           | 重点守护                             |
| ------------- | ---------------------------------------------- | ------------------------------------ |
| organize.ts   | `tests/ai/organize.test.ts`                    | ★ 三条硬护栏 + 上限拒绝 + 半程不回滚 |
| hostAccess.ts | `tests/ai/hostAccess.test.ts`                  | manifest 一致性 + 双 pattern 全授予  |
| classify.ts   | `tests/ai/classify.test.ts`                    | 越界丢弃 + 被丢组落 unclassified     |
| 取消语义      | `tests/ai/abort.test.ts`                       | 批次边界 + 变异探针                  |
| provider.ts   | `tests/ai/provider*.test.ts`, `stream.test.ts` | 协议形状 / SSE / AbortError 透传     |
| config 的 key | `tests/ai/seedKey.test.ts`                     | 预填三条自律                         |
| dedupe 各态   | `dedupe.test.ts` / `semanticDedupe.test.ts`    | 确定性 + 候选生成                    |
| 导航直达      | `tests/optionsNav.test.ts`                     | navPane 初始值必须非法               |
| locale 占位符 | `tests/i18nPlaceholders.test.ts`               | 三侧编号一致、禁非法 `$N$`           |

改任何 `src/ai/` 文件后跑 `pnpm check`（typecheck + lint + fmt:check + test）。提交信息带 `fix(ai):` / `feat(ai):` 前缀（release-please 据此定版本，见 `AGENTS.md` 第 2 节）。
