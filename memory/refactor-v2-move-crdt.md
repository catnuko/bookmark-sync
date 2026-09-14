# v2 Move-CRDT 重构经历（2026-09-14 定稿）

> 工作记忆归档：bookmark-sync 从旧「快照整体上传」模型重构为 **v2 Move-CRDT 操作日志**模型的完整经历。
> 从 P0 到 Edge 三端联合验证 + v2.0.0 发布，含决策、关键实现、踩坑与死路。新会话接续本项目前先读本文件与 `docs/NEXT-STEPS.md`。

---

## 1. 背景与起点

- **旧模型**：书签快照整体上传/下载，冲突靠整树覆盖，多端并发编辑收敛弱。
- **重构目标**：操作级同步 + 离线合并 + 操作级 E2EE + 多浏览器（Chromium/Firefox/Edge）。
- **理论基座**：研究仓库 `bookmark-crdt-sync`（Kleppmann Move-CRDT 论文移植，5 Phase、103 单测、8 个真实 Chromium E2E 场景）。本重构**核心算法/E2EE/持久化逐字节移植**（diff 0 差异），**同步层 Merkle-DAG（CID/DAG-Syncer/Broadcaster/WS 中继）有意替换**为 Supabase 中心化操作日志（收敛与"服务端只见密文"语义等价保留）。

### 用户拍板的长期决策（贯穿全程）
- Move-CRDT 操作日志模型；**不拆仓**（沿用现有 repo）
- 构建产物移出 git；渐进式 TS + vitest
- **操作级 E2EE**（服务端只见密文）；Supabase 只删 `bsync_*` 前缀
- **无客户，可大胆重构**；每任务完成即提交推送（git 身份 `-c user.name=catnuko -c user.email=catnuko@users.noreply.github.com`，分支 `refactor/plan`，禁改 main）

---

## 2. 阶段与成果（按提交链）

| 阶段 | 提交 | 核心内容 |
|---|---|---|
| P0 SW 冷启动 | `66f62fb` | 场景3：优雅关闭浏览器同 profile 重启 → 书签保留（`e2e-two-device.mjs`） |
| P1 跨浏览器 | `b17ff1e` | Chromium × Firefox 双向同步收敛（`e2e-ff-sync.mjs`） |
| P2 收敛收尾 | （并入 P0/P1） | index clamp、冷启动全量重放保护、e2e 自清理 |
| P3 产品化 | `47c37d2` | 快照+GC、密钥导入 UI、共存策略、迁移 0018 |
| 菜单同步 | `4ed8180` | Firefox `menu________` ↔ Chromium/Edge「书签菜单」文件夹 |
| Edge 三端 | `86f83f8` | Chromium × Firefox × Edge 三方收敛 + 菜单双向 + Edge 冷重启（`e2e-triple-sync.mjs`） |
| 发布 | `c72a691` + tag `v2.0.0` | BREAKING CHANGE（schema 0017 重建）；GitHub Release 附双 zip |

### P0 — 冷启动恢复（含关键 bug 修复）
- **reverseApply 事件守卫回环 bug**（本项目最痛的坑）：`guard.value = true` 实际设置的是 `{suppressed:{value}}` **外层**新属性，事件闭包读的 `suppressed.value` 从未置位 → reverseApply 每次建书签触发 onCreated 回环成新 op → 每次同步复制一批书签（A 树曾出现 A1×3）。修复为 `guard.suppressed.value = true/false`。
- 冷启动 `idMap` 恢复等待（`ensureBridgeReady`）：防 reverseApply 在映射加载完成前把已有书签当缺失重建。

### P1 — 跨浏览器根 id 适配
- Chrome 根是数字 `"0"/"1"/"2"/"3"`，Firefox 是 guid `root________/toolbar_____/unfiled_____/mobile______`（另 `menu________` 书签菜单）。
- `chromeBridge.ts` `fixedRootUuid`/`ALL_ROOT_PAIRS` 收录全部；**backward（uuid→chromeId）只 seed 本环境根**——两环境根都 seed 会让同一 uuid 的 backward 被后写覆盖（OTHER ← 'unfiled_____' 覆盖 '2'），Chromium 下 `toChromeId(OTHER)` 返回 Firefox guid → `"Bookmark id is invalid."` → 每次 reverseApply 失败。
- `IS_FIREFOX` 按 UA 判定（Firefox 系 → guid 体系；Chromium/Edge 系 → 数字 id）。Edge UA 含 `Edg/` → 走 Chromium 路径。
- Firefox 端用 **postMessage 测试桥**（`e2e/test-bridge/`，id `bsync-test-bridge@test.local`）经 BiDi 驱动真实 Firefox。

### P3 — 快照 + op_log GC
- `replica.exportSnapshot/applySnapshot`：快照 = 加密后的最终树投影；`gcWatermark` 跳过旧 op；`applySnapshot` 后本地 counter 抬到 watermark 之上。
- `bsync_snapshots` 表 + RPC（`bsync_snapshot_pull`/`bsync_op_maybe_gc`/`bsync_profile_set_used`），迁移 0018（supabase 子模块 `1179b5d`）。
- 共存策略：不接管原生同步、两套云端并存建议二选一（"共存与存储"UI 面板）。

### 菜单同步 — MENU_UUID 第 5 固定根
- CRDT 新增固定根 `MENU_UUID`（'…0004'）：`ensureRoots` 构建 5 根（counter 1..5）、`isBare` 保护集、**`applySnapshot` 后补 `ensureRoots()`**（旧快照无 MENU_UUID，补根防 createNodeWithId(parent=MENU_UUID) 悬空）。
- Chromium 端 `ensureMenuFolder`：reverseApply 前在书签栏下自动创建「书签菜单」文件夹绑定 MENU_UUID（守卫内创建防回环、用户删除自动重建、id 持久化 `crdt.menuFolderId`）；Firefox 端直接映射原生 `menu________`。
- 事件层把「已映射到固定根的动态 id」当固定根拦截（create/change/move/remove 不产生 CRDT op），容器内普通节点正常同步。

### Edge 三端联合
- Edge 二进制：`/opt` 只读（无 root、sudo 被 no-new-privileges 拦）→ 微软仓库（代理 `http://127.0.0.1:8118`）下载 `microsoft-edge-stable_153.0.4234.32` deb（192MB），`dpkg-deb -x` 解包到 `/home/user/tools/msedge/opt/microsoft/msedge/msedge`。
- 复用 `launchChromium`（`CHROME_BIN` 指向 msedge）：Edge 是 Chromium 系，根 id 数字体系 + UA `Edg/` → `IS_FIREFOX=false`；扩展 id 与 Chromium 相同（同路径 hash）。
- **修复 `waitForExtensionSw`**：Edge 内置扩展（`background.rollup.js`）抢占首个 service_worker target → 抓错 id → popup `ERR_FILE_NOT_FOUND`；改为匹配 `/background.js`（本扩展 SW）。
- 端差异：Edge 中文 UI 根标题「收藏夹栏/其他收藏夹」（Chromium「书签栏/其他书签」），但**根 id 不变** → 同步不受影响（反证根适配按 id 而非标题）。

---

## 3. 关键技术细节速查

- 删除 = 移到 `TRASH_NODE_ID`（`__trash__`，论文 §3.6）；`getVisibleTree` 从 ROOT BFS（trash 不可达 → 不可见）；`removeTrashedNodes` 从 Chrome 移除不可达且有映射的节点（最深优先，未映射节点不动防数据丢失）。
- E2EE：AES-256-GCM 信封 `{iv, ciphertext}`，AAD 绑定 `space_id`（无 DAG parents 可绑的等价防重放）；PBKDF2 passphrase + 邀请链接；`keyManager.ts` UI 层。
- 快照墓碑：**未移植 `purgeTombstones`**——墓碑永久留在快照/内存（成本问题非正确性问题；正确性闭环：删除/收敛/新设备重建全正常）。需在"万级书签 + 高频删除"时再补。
- GC：`maybeGc(threshold)` 本机投影加密后请求截断；`crdt.gcThreshold` 可调（0=关闭）。

---

## 4. 已验证死路（勿重试）

- `chrome.runtime.reload()`：本 Chromium 146 无法唤醒 SW。
- Firefox WebDriver：导航/跳转 `moz-extension://`、`wrappedJSObject`/`exportFunction`/CustomEvent 跨 realm 桥、`moz:install-temporary-extension` capability（geckodriver 0.36）。
- `npx supabase` wrapper：缺 linux-x64 二进制（用 `/home/user/.local/bin/supabase`）。
- 向 `/opt` 写入：Permission denied（sudo 亦被 no-new-privileges 拦）→ 二进制一律解包到 `/home/user/tools/`。

---

## 5. 环境事实（会话续接用）

- **二进制**：Chromium `/opt/browser/chrome`；Firefox `/home/user/tools/ff/firefox/firefox`（155.0.1）；Edge `/home/user/tools/msedge/opt/microsoft/msedge/msedge`（153）；geckodriver `/home/user/tools/geckodriver`。
- **端口**：A(Chromium)=9345、B(Firefox)=9346（geckodriver 9444 / BiDi 9446 / 桥 9455）、C(Edge)=9347；Xvfb `:99`（DISPLAY=:99，必须有头）。
- **Supabase**：项目 `cwtqnsbpcetvqopdkcou`；测试账号 `346746061@qq.com`/`Qzy123456`；ANON key `sb_publishable_ezewylV3uHkEXOC6s-eJPg_svk8kI3H`；CLI `/home/user/.local/bin/supabase`；子模块迁移水位 0018（catnuko/supabase-snaply-multi）。
- **E2E 清单**：`e2e-two-device.mjs`（双端+场景3）、`e2e-ff-sync.mjs`（跨浏览器+菜单，先 `pnpm build:firefox`）、`e2e-gc.mjs`（快照 GC 三端）、`e2e-triple-sync.mjs`（三浏览器联合，`EDGE_BIN` 可覆盖）。统一：`EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/…`。
- **单测**：`npx vitest run` → 95/95。
- **清理**：`ps -eo args | grep -E "e2e/.profiles|e2e/.ff-profiles|geckodriver"`，端口被占先杀。

---

## 6. 质量与发布

- 单测 **95/95**；四条 E2E 全绿（双端+冷重启、跨浏览器+菜单、快照 GC、三浏览器联合）。
- **v2.0.0 发布**（`c72a691` + tag `v2.0.0`）：BREAKING CHANGE（schema 0017 DROP 旧表重建，旧客户端/旧云端数据不兼容）；GitHub Release 附 `bookmark-sync-chromium-2.0.0.zip`（Chrome/Edge 共用）+ `bookmark-sync-firefox-2.0.0.zip`。
- **发布流程教训**：仓库自带 release-please 自动发版（推 main 触发）。手动发布时它按提交判 minor（1.2.0）建了 PR，与手动 2.0.0 冲突 → 关闭 PR；随后识别到 BREAKING CHANGE footer 又开内容无变化的 PR，再关。**未来重构类提交记得带 `BREAKING CHANGE` footer**，让 release-please 自动走 major。

---

## 7. 遗留与后续

- `purgeTombstones`（墓碑清理）未移植——暂不需要，海量删除场景再补。
- 10k 节点基准（bench/）未带。
- Safari 验证与产物同步适配（`build-all` 已有骨架，Xcode 工程在 `bookmark-sync/` 子目录，`sync-extension.sh` 幂等同步）。
- 本目录（`memory/`）为项目**通用记忆库，所有 agent 可读**（原 `.workbuddy/`，2026-09-14 更名）。历史内容 `guideline.md`、`new-device-first-sync/` 在 git 历史 `e1c892e` 的 `.workbuddy/` 下可查；个人每日记忆放 `memory/memory/`，保持 gitignore 忽略。
