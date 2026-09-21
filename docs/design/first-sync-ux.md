# 新设备首同步方案（待实施）

> 产出背景：2026-09-13 会话中与项目所有者讨论定稿的方案，**尚未写任何代码**。
> 新会话直接读本文件即可继续实施。实施前先看本文「0. 仓库当前状态」。

> **【2026-09-13 实施状态更新】§4 实施清单 1~3 已全部完成，构建通过（vite + firefox），未提交。**
>
> - `src/sync.js`：旧账号级 mergeAck / `merge_confirm_needed` 已删除并整体替换为四象限首同步判定（`first_sync_confirm_needed`，附 localCount / remoteCount / localOnlyCount / remoteEncrypted / hasTombstones + spaceId）；ack 键为 `firstSyncAck:<uid>:<spaceId>`；新增 `pullOverwriteLocal()`（pull → applyNodes → 基线重置为远端 → push 一次登记设备）；新增 `countLocalOnlyBookmarks()`（覆盖警告的精确删除条数，身份规则与 applyNodes 保留规则一致）。
> - `src/App.vue`：旧 merge modal 替换为首同步决策 modal（条数对比、合并/覆盖/暂不同步三选项、覆盖 armed 两步确认、E2EE 先导密钥——导入成功后自动重新 runSync 检测回到四象限）。
> - `src/background.js`：pending 文案区分「等待确认(首同步)」与「等待同步密钥」。
> - 追加 UI 调整（所有者反馈）：「同步密钥 / 空间与设备」改为 seg tab 互斥切换；设备区改名「同步中的浏览器」，每台设备带最近同步的空间名，移除改为「解除」（armed 两步确认 + 逃生通道说明），裸 UUID 设备名回退为「未知设备 · 短标记」。
> - **与方案的一处偏差**：字段命名 `hasTombstones`（非 hasFreshTombstones）——pull RPC（0012）返回的墓碑只有 `{sync_id, url}` 无 `created_at`，客户端无法判时间窗；按方案主路径实现为「远程空 && 有墓碑 && 本地有书签 → 走确认」（宁保守不打扰反例：老墓碑+远程空会多弹一次确认）。
> - 剩余：§4 第 5 条验证（本地场景/截图 mock）与 §5 遗留待办（0016 部署、提交发版）。服务端确认无需新迁移。

## 0. 仓库当前状态（重要）

本轮（UI 重构 + 额度按条展示）改动**已完成但未提交**，新会话开始时先确认 `git status` 与下表一致：

| 位置                     | 状态         | 内容                                                                                                                                                                                                                  |
| ------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.vue`            | 已修改未提交 | 黑白主题 UI 重写；移除历史记录功能；移除手动设备命名；配额改按条展示（Free 500 / Plus 10,000 / Pro·Lifetime 不限数量）；`window.prompt/confirm` 替换为行内改名 + 两步删除确认                                         |
| `src/sync.js`            | 已修改未提交 | 设备名自动检测（`getDeviceName` 解析 UA → "浏览器 · 系统"）；删除 `listSnapshots`/`restoreSnapshot`/`getActiveSpaceId`/`setDeviceName`；新增 `countServerBookmarks()`（本地基线条数回退）；合并确认结果带 `device_id` |
| `supabase/`（submodule） | 未提交       | 新增 `migrations/0016_profile_used_count.sql`（`bsync_get_profile` 返回 `used_count`）；`TENANTS.md` 水位 0012→0016。**0016 尚未 `db push`，等所有者审查**                                                            |
| 产物                     | 已重建       | `extension/`、`extension-firefox/`（gitignore，勿提交）                                                                                                                                                               |

关键事实：**HEAD（3b5d05d）里仍有旧版 `restoreSnapshot` / `applyNodes(restore:true)` 完整实现**，本方案「远程覆盖本地」路径可直接从 git 历史找回（`git show HEAD:src/sync.js`）。

## 1. 需求原始表述（所有者原话归纳）

自动检测到新设备时：

1. 若账号下已有同步过的远程数据 → 发出同步确认，让用户确认是否从远程同步到本地，**警告将覆盖本地书签**；
2. 若无远程数据 → 自动把本浏览器书签同步到远程，尽量无感。

所有者提问：「新设备」应该是新浏览器还是新用户空间？→ 结论见 §3。

## 2. 讨论定稿的方案：四象限 + (设备×空间) 级确认

### 2.1 判定单位与触发时机

- 判定单位 = **(deviceId, spaceId) 组合**；触发时机 = 该设备**第一次与某空间建立同步**。
- 本地信号（现成可用）：该空间**没有 baseline**（`lastSyncBaseline[:spaceId]`，见 sync.js `loadBaseline`/`scopedGet`）= 首次；决策完成写入基线后即为「老设备」，正常增量同步永不再弹。
- 为什么不是单一维度：
  - 只按浏览器（deviceId）：同设备后切「工作」空间会跳过确认直接并集合并，可能混入不想要的数据；
  - 只按空间：设备登记、墓碑归属都在 deviceId 上，空间没有设备概念；
  - 现状是**账号级** ack（`mergeAck:<userId>`，见 sync.js `isMergeAcknowledged`/`acknowledgeMerge`）：确认的是「有其他设备」而非「这棵树怎么处理」，且一次确认全账号永久生效、换空间不再询问 → 本方案将其**取代**。

### 2.2 四象限行为矩阵（首次同步该空间时）

| 本地书签       | 远程书签 | 行为                                                                                  |
| -------------- | -------- | ------------------------------------------------------------------------------------- |
| 空（全新安装） | 有数据   | **自动拉取**（无感，最高频场景，不打扰）                                              |
| 有数据         | 空       | **自动推送**（无感）                                                                  |
| 空             | 空       | 只登记设备（push 即登记），无事发生                                                   |
| 有数据         | 有数据   | **弹确认**（唯一打断点），三选一：合并（推荐，= 现三态合并）/ 远程覆盖本地 / 暂不同步 |

- 「本地空/有数据」判定：`readLocalTree()` 结果中 `type==='bookmark'` 节点数为 0 / >0（文件夹不计）。
- 「远程有数据」判定：`bsync_snapshot_pull` 返回的 `bookmarks` 数组非空（runSync 首步本来就会 pull，无额外开销）。

### 2.3 「远程覆盖本地」= 新引擎路径（不是现有 runSync）

现状：新设备（基线空）跑 `runSync` = 并集（本地新增全部保留并上传），**没有覆盖语义**。覆盖路径需新写：

```
pullOverwriteLocal():
  1. pull 拿远端节点（e2ee 时解密）
  2. applyNodes(remoteNodes, maps)   ← 直接复用现有 applyNodes（目标集之外的本地节点会被删除）
  3. saveBaseline(afterPull)          ← 基线重置为远端
  4. 只推一次空变更或正常 push（登记设备 + 让服务端 used_bytes 刷新）
```

注意：

- 参考实现 = HEAD 里的 `restoreSnapshot`（apply + 重置基线 + push），可整体搬运改造成无 UI 入口的内部函数；
- 覆盖后本地多出的书签被删除且**不产生墓碑**（基线里没有它们）——即覆盖是本机行为，不传播删除，这符合语义；
- 警告文案要精确：「云端的 X 条书签会同步下来；本机有、云端没有的书签（N 条）将被删除」，而不是笼统的「清空本地」。

### 2.4 边界情况（必须处理）

1. **E2EE 无感不了，也不应绕过**：新设备无密钥时远程是密文。流程分支：远程是密文 && 本地无密钥 → 先弹「导入密钥/输入口令」引导（现有 `decrypt_error` 的 UI 文案可复用），导入成功后回到四象限决策。这是加密设计在起作用。
2. **远程空但有新鲜墓碑**：说明有设备刚清空过账号，自动推送 = 往刻意清空的账号灌书签。建议：远程 bookmarks 空 && tombstones 非空 → 不自动推送，走确认（或至少检查墓碑时间窗，如 7 天内）。墓碑数据 pull 已返回（`pullData.tombstones`）。
3. **Chrome 多 profile**：每个 profile 独立 deviceId + storage → 天然各自触发首同步判定，正确（这正是历史上「多资料混书签」事故的防线）。
4. **合并确认 modal 的关系**：现有账号级「此账号已在其他设备上同步」弹窗被本方案**整体取代**（数据级决策取代设备级知会）；`mergeAck:<userId>` 迁移为 `mergeAck:<userId>:<spaceId>`（或直接以 baseline 存在性为准，决策结果持久化一份用于审计/文案）。旧 ack 键可忽略不迁移（老用户下次首同步再确认一次，代价可接受）。
5. **后台管线**：`background.js` 的 `onInstalled/onStartup` 自动 runSync 维持；四象限的「确认」分支在后台**不自动执行**，落一个 pending 状态（复用现有 `merge_confirm_needed` + `lastSyncStatus: "等待确认…"` 模式），打开 popup 时弹出决策 UI。

## 3. 所有者问题的结论（写进方案 FAQ）

**Q：新设备是新浏览器还是新用户空间？**
A：都不是单独的答案，判定单位是 **(设备, 空间) 组合** —— 某设备第一次与某空间建立同步时触发（§2.1）。设备维度回答「是谁」，空间维度回答「对哪棵树」，缺一会漏掉「老设备切空间」或误伤「多空间同设备」场景。

## 4. 实施清单（新会话按此开工）

1. `src/sync.js`：
   - `runSync` 内、merge 确认判定处，改为 (设备×空间) 首同步检测：无 baseline && 未 ack → 返回 `first_sync_confirm_needed`（附：localCount / remoteCount / remoteEncrypted / hasFreshTombstones）；
   - 四象限的三个自动分支在 runSync 前置判定里直接放行（本地空+远程有 → 照常执行即天然并集拉取；本地有+远程空 → 照常执行即天然推送，无需特殊代码！）；
   - 新增 `pullOverwriteLocal()`（§2.3）；
   - ack 键升级为含 spaceId；
   - 复活自 HEAD `restoreSnapshot` 的 apply+重置基线逻辑。
2. `src/App.vue`：决策 modal（替换现 merge modal）：显示双方条数对比、三个选项、覆盖需二次确认（复用 armed 两步确认模式）、E2EE 先导密钥分支。
3. `src/background.js`：pending 状态文案区分「等待确认」与「等待确认(首同步)」。
4. 服务端：**无需新迁移**（判定全在本地 + pull 数据；设备登记现有 `bsync_device_touch` 已覆盖）。
5. 验证：`scripts/verify-sync-local/` 补场景（首同步四象限 + 覆盖后重加）；mock 预览截图（`dev-preview.html` 模式，见 git 历史）。

## 5. 遗留待办（与方案并行）

- **官网文案**：仓库不在本机（已找过 snaply/、catnuko.github.io 等，无）。需所有者提供仓库位置。需改点（已从线上 bundle 核实）：meta description「100 条历史快照回滚」、keywords「书签历史回滚」、FAQ 与功能卡中的历史回滚宣传 → 与扩展现状对齐（历史回滚已从扩展 UI 移除，v1.2 起不宣传）。
- **0016 迁移部署**：`cd supabase && supabase db push`（等审查）。
- 本轮 UI/额度改动与 0016 一起提交发版（conventional commits：`feat:`/`fix:` 前缀，release-please 自动升版）。

## 6. 定价与展示口径（新会话可能用到）

- 定价（官网线上 bundle 核实）：Free 500 条 / Plus $20/年 10,000 条 / Pro $50/年 不限数量。
- 服务端执行口径不变：`quota_bytes`（free 5MB / plus 50MB≈2.5万条 / pro 500MB≈25万条，0013 有意留 ~2.5x 余量）。
- 扩展展示口径：条数。`used_count` 优先取 `bsync_get_profile`（0016 部署后），回退本地基线统计（`countServerBookmarks()`）。
