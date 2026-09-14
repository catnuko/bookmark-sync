# 交接文档：bookmark-sync Move-CRDT 重构 — 下一步任务

> 用途：新会话接续任务的唯一入口。先读本文件，再按「快速开始」复现环境，然后从「任务清单」继续。
> 生成时间：2026-09-14 · 分支：`refactor/plan`（P0/P1/P2/P3 全部完成，见提交记录）

---

## 1. 项目全景

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/catnuko/bookmark-sync（私有） |
| 开发分支 | `refactor/plan`（**禁止直接改 main**） |
| Supabase 子模块 | `supabase/` → catnuko/supabase-snaply-multi（main，迁移水位 **0018**） |
| 项目 ref | `cwtqnsbpcetvqopdkcou` |
| 测试账号 | `346746061@qq.com` / `Qzy123456`（Supabase Auth 邮箱登录） |
| Management API token | `~/.supabase_access_token`（sbp_fcf98872fbc66d31e8f5d3f251fa6b4ad499f303） |
| 测试浏览器 | Chromium 146 @ `/opt/browser/chrome`（进程名 `chrome`），Xvfb `:99` |
| 参考实现 | `/home/user/Doubao/chats/38441509014479362/bookmark-crdt-sync`（已验证 MV3 E2E 8/8） |

**核心决策（用户拍板）**：同步引擎升级 Move-CRDT 操作日志模型；不拆仓；构建产物移出 git；渐进 TS + vitest；操作级 E2EE；Supabase 新增 `bsync_op_log` 表；**只删 `bsync_*` 前缀表**；测试脚本放 `e2e/` 复用；无客户可大胆重构。

**架构一句话**：chrome.bookmarks 事件 → Move-CRDT op（`bsync_op_log`，AES-GCM 加密）→ Supabase RPC（`bsync_op_push/pull`）；SW 为同步权威，reverseApply 把合并结果写回本机树；`crdt.afterId` 水位增量拉取。

---

## 2. 已完成工作（时间线）

### 2.1 重构基础（已交付）
- **审计 + 方案**：`docs/refactor-plan.md`（385 行），6 决策点用户全拍板"是"
- **Supabase v2**：DROP 全部旧 `bsync_*` 对象（7 表+13 函数+1 触发器）；新 schema 固化于子模块 `migrations/0017_v2_move_crdt.sql`（bsync_spaces / bsync_devices / bsync_op_log / bsync_snapshots / RLS / bsync_op_push / bsync_op_pull）；旧数据备份 `/tmp/bsync_backup/old_data.json`
- **代码**：`src/crdt/`（Move-CRDT 引擎）、`src/sync/`（syncEngine / chromeBridge / opCrypto / keyManager）、`src/sync.js`（编排）、80 单测全绿

### 2.2 真实 Chromium 双设备 E2E（本轮核心，已 PASS）
`e2e/e2e-two-device.mjs` 标准场景**多次完整 PASS**（exit=0）：
- 远端写回本机（reverseApply）：B 同步状态 `推送 1 · 拉取 1` 无 error，B 树出现 A 的书签
- 双向传播：A ↔ B 双向收敛 `true`
- 提交链：`d1b723e`（事件接线）→ `0db7036`（create 单对象签名等）→ `416bf69`（本轮）

### 2.3 本轮修复清单（commit `416bf69`）
| 修复 | 说明 |
|---|---|
| index clamp | `chromeBridge.ts`：create/move 的 index 限制在 `0..siblings.length`，根治 chrome `Index out of bounds` |
| 冷启动保护 | `replica.isBare()` + `syncEngine.pullFrom(0)` + `runSync` 接线：SW 冷重启（内存 CRDT 空）且云端有历史时先全量重放再 reverseApply，防止空 CRDT 视图把本机书签树清空（曾实测把 A 设备书签删到只剩两个固定根） |
| e2e 自清理 | 按 `e2e/.profiles` 路径特征杀残留 Chromium（`pidof chromium` 匹配不到实际二进制 `/opt/browser/chrome`）；fuse 文件 EBUSY → 轮询等待进程退出再 rm |
| popup 登录等待 | `popup.mjs` 输入框轮询（Vue 渲染时序） |

### 2.4 本会话修复（commit `66f62fb`，已推送）
| 修复 | 说明 |
|---|---|
| **reverseApply 回环 bug（根因）** | `sync.js` `reverseApplyIntoChrome` 事件守卫写错层级：`guard.value = true` 给 `{suppressed:{value}}` 外层加新属性，事件闭包读的 `suppressed.value` 从未置位 → 守卫静默失效 → reverseApply 每次建书签都被 onCreated 捕获成新 op 推回云端 → 对端再 reverseApply → **每次同步复制一批书签**（曾实测 A 侧 A1×3、op_log 13 条）。修复为 `guard.suppressed.value = true/false`。op_log 从 11-13 降到 2（仅 A1+B1 create），双端各恰有 1 个 |
| 冷启动 idMap 竞态防御 | `getOrCreateBridge()` 的 idMap 恢复改为可 await 的 `_idMapReady`，`runSync` reverseApply 前、`seedExistingTree` 前 `await ensureBridgeReady()`：防 SW 冷启动后 reverseApply 在 idMap load 完成前把已有书签当缺失重建 |
| 场景 3 改优雅重启 | `e2e-two-device.mjs` 场景 3：`chrome.runtime.reload()` → SIGTERM 优雅关闭 → 等 CDP 端口/进程退出 → 同 profile 重启 → onStartup 自动 sync（kill -9 会损坏 profile 扩展状态 → ERR_BLOCKED_BY_CLIENT） |
| e2e 计数断言 | 收敛断言从「存在性」升级为「计数 === 1」（A1/B1 各恰有 1 个），防回环类回归 |

### 2.5 P1 Firefox 跨浏览器同步（本会话，commit 待提交）
**验收通过**：`e2e/e2e-ff-sync.mjs`（A=Chromium、B=Firefox 双向同步）**2 次连跑全绿**，`双向收敛 true`（A1×1/B1×1 两端）、op_log 恰 2 条；`e2e-two-device.mjs` 与 `ff-smoke.mjs` 回归均 PASS。
| 项 | 说明 |
|---|---|
| **Firefox 根 id 适配** | Chrome 根是数字 `"0"/"1"/"2"/"3"`，Firefox 是 guid `root________/toolbar_____/unfiled_____/mobile______`（另有 `menu________` 书签菜单）。`chromeBridge.ts` `fixedRootUuid`/`ALL_ROOT_PAIRS` 收录全部；**backward（uuid→chromeId）只 seed 本环境根**——两环境根都 seed 会让同一 uuid 的 backward 被后写覆盖（OTHER ← 'unfiled_____' 覆盖 '2'），Chromium 下 `toChromeId(OTHER)` 返回 Firefox guid → chrome `"Bookmark id is invalid."` → A 的 sync 每次 reverseApply 失败（实测 lastSyncError）。`IS_FIREFOX` 按 UA 判定；`IdBridge.load()` 跳过非本环境固定根 |
| **Firefox 特殊根不播种** | `sync.js` `seedExistingTree` 走固定根映射续走子树（root/menu/toolbar/unfiled/mobile 均映射 CRDT 固定根，不产生根 op）；P3 前 `menu________` 无映射被当普通节点播种 → reverseApply 试图 `chrome.move(menu 根)` → `"The bookmark root cannot be modified"` |
| **menu________ 参与同步（P3 后）** | 新增 CRDT 固定根 `MENU_UUID`（'…0004'）：Firefox 端映射原生 `menu________`；Chromium 端由 `ensureMenuFolder` 在书签栏下自动创建「书签菜单」文件夹并绑定 MENU_UUID（reverseApply 前守卫内创建，用户删除后自动重建）。事件层把「已映射到固定根的动态 id」当固定根拦截（不产生 CRDT op），menu 子树节点正常同步。测试建书签 `toolbar_____` / `menu________` 均可 |
| **postMessage 测试桥** | Firefox WebDriver 禁止导航/跳转 `moz-extension://`（about:blank 与 http 页 location.href 均被拦）。`e2e/test-bridge/`（id `bsync-test-bridge@test.local`）content script 用 `window.postMessage` 桥（Firefox 内容脚本↔页面标准通道，结构化克隆无 Xray 问题）转发 `onMessageExternal` 白名单命令（`src/testChannel.js`） |
| **桥方案死路（勿重试）** | wrappedJSObject 赋函数（Xray Permission denied）；`Cu.exportFunction`（页面调用仍 Permission denied，参数/返回值跨 realm 克隆受限）；DOM CustomEvent 跨 realm（内容脚本收不到页面事件）；WebDriver 导航 moz-extension://（含 http 页跳转） |
| 测试脚本 | `e2e/ff-smoke.mjs`（Firefox 单端：login→sync→create→getTree）、`e2e/e2e-ff-sync.mjs`（跨浏览器双端）、`e2e/lib/{bidi,launchFirefox,ffbridge}.mjs`、`e2e/test-bridge/` |

### 2.6 P3 产品化缺口（本会话，完成）

**三缺口全部交付**：① `bsync_snapshots` 启用（快照+GC，防 op_log 无限增长）② E2EE 密钥导入 UI（探查确认 App.vue 已有完整面板，无需新做）③ 与原生 Chrome Sync 共存策略（新增"共存与存储"UI 面板）。

**快照 + GC（P3①）**：
| 层 | 内容 |
|---|---|
| `replica.ts` | `exportSnapshot()`（投影 `{w, nodes}`）/ `applySnapshot(snap)`（重建树+清 log+置 gcWatermark+本地 counter 抬到 watermark 之上）/ `SnapshotData` 接口（index.ts 导出） |
| `oplogClient.ts` | 接口加 `SnapshotRow`/`GcResult`/`snapshotPull(spaceId)`/`maybeGc(spaceId, threshold, projection)`；Memory 与 Supabase 实现同步补齐（Supabase 调 `bsync_snapshot_pull`/`bsync_op_maybe_gc`） |
| `opCrypto.ts` | 抽通用 `encryptJson/decryptJson`（快照与 op 复用同信封，E2EE 保持——服务端只见密文投影）；`encryptMoveOp/decryptMoveOp` 改为薄封装 |
| `syncEngine.ts` | `pullWithSnapshot(force=false)`：快照新于本地水位（或 force 冷启动 / afterId=0）→ 解密重建 + 增量 pull；解密失败回退增量；force 无快照时 `pullFrom(0)`。`maybeGc(threshold)`：本机投影加密后请求截断 |
| `sync.js` | runSync：① 冷启动保护改 `pullWithSnapshot(true)`（GC 截断后 `pullFrom(0)` 会漏行）② 常规拉取 `pullWithSnapshot(false)` ③ GC 阈值 `crdt.gcThreshold`（storage 可覆盖，默认 2000，E2E 注入 1 验证）flushPush 后触发，成功写 `lastGcAt` ④ used_count 客户端上报 `bsync_profile_set_used`（meta 无 type 字段，口径=可见树 url 非空的节点数；RPC 由 0018 创建，try/catch 不阻塞） |
| 迁移 0018 | `supabase/migrations/0018_snapshot_gc.sql`：`bsync_snapshot_pull(p_space)`→最新快照行或 null；`bsync_op_maybe_gc(p_space, p_threshold, p_projection)`→行数超阈值时（pg_advisory_xact_lock 同空间串行化）落快照（after_op_id=当前 max id）→ 删 op id<=max → 清旧快照只留最新；`bsync_profile_set_used(p_used)`；`bsync_get_profile` 改读 `used_count` 列（0016/0017 的快照明文统计口径废弃——快照加密后服务端无法自算）；`ALTER TABLE bsync_profiles ADD COLUMN used_count` |

**验收**：`tests/sync/snapshot-gc.test.ts` 9/9（transport 截断/保留最新快照、pullWithSnapshot 重建+增量/force 冷启动/解密失败回退/无快照全量、maybeGc 加密投影+新设备重建）；**`e2e/e2e-gc.mjs` 真实 Chromium×3 一次全绿**：A 建 3 书签同步（阈值 1）→ op_log 从 345 行截断到 0、快照 1 行（加密）；C（全新设备）从快照重建收敛（A1-A3 各恰 1）；GC 后 C 建 C1 → A/B 增量拉到；终态双向收敛无重复。全量单测 **92/92**；`e2e-two-device.mjs`（双端+场景3 冷重启）回归全绿。

**共存策略（P3③）**：App.vue 新增"共存与存储"面板（第三个 tab）——Chrome Sync 共存说明（不接管原生同步、两套云端并存建议二选一）+ op-log GC 配置（阈值可调存 `crdt.gcThreshold`，0=关闭；显示 `lastGcAt`）。UI 冒烟通过（面板渲染 + 默认 2000 + "尚未触发"）。

### 2.7 Firefox 书签菜单参与同步（本会话，完成）

**验收**：`e2e/e2e-ff-sync.mjs` 一次全绿（原场景保持 op_log 恰 2 条 + 菜单场景双向收敛 M1/M2 各恰 1）；`e2e-two-device.mjs`（含场景3）与 `e2e/e2e-gc.mjs` 回归 PASS；单测 **95/95**。

| 层 | 内容 |
|---|---|
| CRDT 固定根 | `uuidMapping.ts` 新增 `MENU_UUID`（'…0004'）；`replica.ensureRoots()` 构建第 5 固定根（counter 1..5）；`isBare()` 保护集含 MENU_UUID；**`applySnapshot` 后补 `ensureRoots()`**（旧快照无 MENU_UUID，补根防 createNodeWithId(parent=MENU_UUID) 悬空） |
| chromeBridge | `fixedRootUuid('menu________')=MENU_UUID`；`ALL_ROOT_PAIRS`/`FF_ROOT_PAIRS` 收录；`PROTECTED_UUIDS` 含 MENU_UUID；**captureLocalEvents 四 handler 加「已映射到固定根的动态 id」拦截**（Chromium「书签菜单」文件夹的 create/change/move/remove 不产生 CRDT op） |
| sync.js | 删 `FIREFOX_ROOT_IDS` 整棵跳过（固定根统一走 existing 续走子树——menu 映射后播种安全，不再 move 根）；**`ensureMenuFolder`**：Chromium 端 reverseApply 前在书签栏下自动创建「书签菜单」并绑定 MENU_UUID（守卫内创建防回环；用户删除后自动重建；id 持久化 `crdt.menuFolderId`）；Firefox 端跳过（原生根） |
| 接口 | `ChromeBookmarksAPI` 加 `get(id)`（ensureMenuFolder 存在性检查）；`sync/index.ts` 导出 `IS_FIREFOX` |
| 行为 | Firefox 端 seed 起完整播种全部根子树（含 menu/toolbar/unfiled/mobile）；Chromium 端「书签菜单」= MENU_UUID 容器，内容与 Firefox 菜单双向同步；Firefox 默认预置书签（Mozilla Firefox 等，未播种节点）保留不动 |

**设计要点**：Chromium 端 MENU_UUID 无固定 chromeId → 动态容器 + storage 持久化 id；删除自动重建（与 Chrome 固定根不可删语义一致）；事件层把容器当固定根（不产生 op）但容器内普通节点正常同步。

### 2.8 Edge 三浏览器联合验证（本会话，完成）

**验收**：`e2e/e2e-triple-sync.mjs` 一次全绿：Chromium × Firefox × Edge 三方收敛（A1/B1/C1 三端各恰 1）、菜单双向（Firefox `menu________` ↔ Chromium/Edge「书签菜单」文件夹，M1/M2 各恰 1）、Edge 场景3（SIGTERM 优雅重启同 profile → 书签保留）；回归 95/95 + two-device + ff-sync + gc 全绿。

| 项 | 内容 |
|---|---|
| Edge 二进制 | 无 root（/opt 只读、sudo 被 no-new-privileges 拦）→ 微软仓库 `packages.microsoft.com/repos/edge`（代理 `http://127.0.0.1:8118`）下载 `microsoft-edge-stable_153.0.4234.32` deb（192MB），`dpkg-deb -x` 解包到 `/home/user/tools/msedge/opt/microsoft/msedge/msedge` |
| 复用路径 | Edge 是 Chromium 系 → 复用 `launchChromium`（`CHROME_BIN` 指向 msedge）；根 id 仍是数字 `"0"/"1"/"2"/"3"`、UA `Edg/` → `IS_FIREFOX=false`；扩展 id 与 Chromium 相同（同路径 hash） |
| **修复** | `cdp.mjs` `waitForExtensionSw` 原先取第一个 `service_worker` target——Edge 内置扩展（`background.rollup.js`）先出现会抓错 id → popup ERR_FILE_NOT_FOUND；改为匹配 `/background.js`（本扩展 SW） |
| 端差异 | Edge 中文 UI 根标题是「收藏夹栏/其他收藏夹」（Chromium「书签栏/其他书签」），但根 id 不变 → backward 映射按 id 工作，同步不受影响 |
| 全新 FF profile | 首次同步会把 Firefox 预置书签（Mozilla Firefox 等）播种同步到其他端（完整播种全部根子树，2.7 预期行为）；E2E 断言不受影响 |

**命令**：`EMAIL=… PASSWORD=… E2E_RESET=1 node e2e/e2e-triple-sync.mjs`（`EDGE_BIN` 可覆盖默认 `/home/user/tools/msedge/opt/microsoft/msedge/msedge`）。

---

## 3. 当前状态（验证结果）

- ✅ `npx vitest run`：92/92 全绿（基线 80 + Replica 快照 4 + snapshot-gc 9，oplog 等合并计数）
- ✅ 标准双设备 E2E：远端写回 + 双向同步 PASS（多次）
- ✅ 打包：`pnpm package` 通过（extension/ 含最新逻辑，background.js 含 `bsync-sync` 消息通道）
- ✅ **场景 3（SW 冷重启保留）真实环境 PASS**：改为「SIGTERM 优雅关闭 → 同 profile 重启」（`chrome.runtime.reload()` 在本 Chromium 146 构建中 reload 后 SW 无法被事件唤醒，弃用）。3 次连跑稳定：`SW 重启: true` + `保留 A1/B1: true true`（A1×1, B1×1），op_log 仅 2 条（无回环垃圾）
- ✅ **修复 reverseApply 回环 bug**（重要，见 2.4）：`reverseApplyIntoChrome` 的事件守卫写错层级——`guard.value = true` 实际设置的是 `{suppressed:{value}}` 外层的新属性，事件闭包读的 `suppressed.value` 从未被置位 → reverseApply 每次建书签都触发 onCreated 回环成新 op → 每次同步复制一批书签（A 树曾出现 A1×3）。修复为 `guard.suppressed.value = true/false`。另加冷启动 idMap 恢复等待（`ensureBridgeReady`，防 reverseApply 在 idMap load 完成前把已有书签当缺失重建）
- ✅ **P1 Firefox 跨浏览器同步 PASS**（见 2.5）：`e2e/e2e-ff-sync.mjs` 2 次连跑，Chromium↔Firefox 双向收敛 true、op_log 恰 2 条；`ff-smoke.mjs` 单端 PASS；Chromium 双端回归 PASS。核心修复：跨浏览器根 id 适配（backward 按环境）、Firefox 特殊根不播种、postMessage 测试桥
- ✅ **P3 产品化缺口 PASS**（见 2.6）：快照+GC 全链路（单测 92/92 + `e2e/e2e-gc.mjs` 真实 Chromium×3 一次全绿：op_log 345 行→0、快照落库、第三端从快照重建收敛、GC 后增量仍通）；E2EE 密钥导入 UI 确认已有；共存策略 UI（"共存与存储"面板）完成；迁移 0018 已推送（supabase 子模块 `1179b5d`）
- ✅ **Firefox 书签菜单参与同步 PASS**（见 2.7）：`e2e/e2e-ff-sync.mjs` 菜单场景双向收敛、单测 95/95、双端与 GC 回归全绿
- ✅ **Edge 三浏览器联合验证 PASS**（见 2.8）：`e2e/e2e-triple-sync.mjs` 一次全绿——Chromium × Firefox × Edge 三方收敛 + 菜单双向 + Edge 冷重启保留；全套回归 95/95

---

## 4. 任务清单（新会话从这里继续）

### ✅ P0 — 冷重启真实环境验证（已完成）
- **结果**：场景 3 改为「SIGTERM 优雅关闭 → 同 profile 重启」，`SW 重启: true` + `保留 A1/B1: true true`，3 次连跑稳定，exit=0
- **附带修复**：reverseApply 回环 bug（守卫层级写错，见 2.4）+ 冷启动 idMap 竞态
- 后续若换 Chrome 稳定版，可回归 `chrome.runtime.reload()` 路径（README 已记录）

### ✅ P1 — Firefox 跨浏览器同步（已完成）
- **验收**：A=Chromium、B=Firefox 双向同步收敛 true（计数各 === 1），`e2e/e2e-ff-sync.mjs` 2 次连跑全绿；`ff-smoke.mjs` 单端、`e2e-two-device.mjs` 回归均 PASS
- **核心适配**：Firefox 根 guid 体系（`backward` 按环境 seed，详见 2.5）、Firefox 特殊根不播种、postMessage 测试桥
- **已知限制（P3 后解除）**：Firefox `menu________` 已参与同步（MENU_UUID 固定根，见 2.6/2.7）；测试建书签 `toolbar_____` / `menu________` 均可

### 🟡 P2 — 收敛收尾（完成）
- ✅ 场景 3 并入主脚本后跑通 3 次（防 flaky）
- ✅ `e2e/README.md` 写入已知限制（SW 重启模拟方式、Firefox 差异）
- ✅ `docs/refactor-plan.md` 状态列更新（C 阶段完成）
- ✅ P1 基础设施提交：`e2e/lib/{bidi,launchFirefox,ffbridge}.mjs`、`e2e/test-bridge/`、`src/testChannel.js`、`e2e/{ff-smoke,e2e-ff-sync}.mjs`

### 🟢 P3 — 产品化缺口（✅ 完成）
- ✅ `bsync_snapshots` 表启用（快照 + GC，防 op_log 无限增长）：0018 迁移（`bsync_snapshot_pull`/`bsync_op_maybe_gc`/`bsync_profile_set_used`）+ Replica 快照能力 + transport/syncEngine/sync.js 接线；单测 9 + E2E（e2e-gc.mjs 三端）全绿，见 2.6
- ✅ 操作级 E2EE 的密钥导入 UI（新设备加入流程）：探查确认 App.vue 已有完整面板（导出/导入/口令），无需新做
- ✅ 与原生 Chrome Sync 共存策略：App.vue"共存与存储"面板（二选一提示 + GC 阈值配置 + lastGcAt 展示）
- 可选后续：Safari 验证与产物同步适配（build-all 已有骨架）（build-all 已有骨架）

---

## 5. Firefox 跨浏览器测试 — 已实现（结论与实测要点）

**P1 已完成并验收通过**（见 2.5）。实现要点：

1. **构建**：`pnpm build:firefox` 生成 `extension-firefox/`（manifest 换 Firefox 版：`background.scripts` 事件页语义 + `browser_specific_settings.gecko.id = bookmark-sync@bookmarksync.app`）
2. **API 兼容**：`chrome.bookmarks` / `chrome.storage.local` 在 Firefox 均有；Supabase 走 fetch，无平台差异
3. **驱动层（已落地）**：
   - `e2e/lib/launchFirefox.mjs`：geckodriver 0.36 + WebDriver BiDi（`--port=9444 --websocket-port=9446`，9222 被环境浏览器占用必须换端口；capability 需显式 `webSocketUrl: true`）；扩展用 classic 端点 `POST /session/{sid}/moz/addon/install`（`moz:install-temporary-extension` capability 在 0.36 不可用）；扩展 UUID 用 pref `extensions.webextensions.uuids` 固定
   - **Firefox 无法 WebDriver 导航到 `moz-extension://`**（about:blank 与 http 页 location.href 跳转均被安全策略拦）→ **测试桥**：`e2e/test-bridge/`（id `bsync-test-bridge@test.local`）content script 用 **`window.postMessage`** 桥（内容脚本↔页面标准通道）转发到 bookmark-sync 的 `onMessageExternal` 白名单通道（`src/testChannel.js`，仅 ping/sync/login/logout/storage.*/bookmarks.*）
   - **死路（勿重试）**：wrappedJSObject 赋值函数、`Cu.exportFunction`、DOM CustomEvent 跨 realm、WebDriver/JS 跳转 moz-extension://
4. **环境**：Firefox 155.0.1 @ `/home/user/tools/ff/firefox/firefox`（官方 tarball，代理 `http://127.0.0.1:8118` 下载）；geckodriver 0.36 @ `/home/user/tools/geckodriver`；Xvfb `:99`
5. **测试矩阵（已覆盖）**：A=Chromium ↔ B=Firefox 双端；`ff-smoke.mjs` 单端；后续可扩展三端

# 5. 快照 GC（P3）— 已实现（结论与实测要点）

**P3 已完成并验收通过**（见 2.6）。实现要点：

1. **服务端**：迁移 0018（子模块 `1179b5d`）——`bsync_snapshot_pull` 返回空间最新快照行；`bsync_op_maybe_gc` 事务内（`pg_advisory_xact_lock` 同空间串行化防并发 GC 互删快照）：行数>阈值 → 落快照（`after_op_id`=当前 max id，data 为客户端加密投影）→ 删 `id <= after_op_id` 的 op → 只保留最新快照；`bsync_profile_set_used` 写 `used_count` 列；`bsync_get_profile` 改读列（0016/0017 快照明文统计废弃——快照加密后服务端无法自算）
2. **客户端基线选择**（`pullWithSnapshot`）：快照存在且 `after_op_id > afterId`（或 `afterId===0` 新设备 / `force` 冷启动 bare）→ 解密快照重建 replica（`applySnapshot`：清 log + 置 gcWatermark，旧 op 收到即跳过）+ 增量 pull；解密失败回退增量；force 无快照时 `pullFrom(0)` 全量
3. **GC 触发**（runSync）：flushPush 后若 `gcThreshold>0` 且有推送/拉取 → `maybeGc`；阈值存 `crdt.gcThreshold`（storage 可覆盖，默认 2000，E2E 注入 1），成功写 `lastGcAt`
4. **E2E 验证**：`e2e/e2e-gc.mjs`（Chromium×3：A 建书签同步触发 GC → op_log 截断+快照落库 → C 新设备从快照重建收敛 → GC 后增量仍通 → 终态双向收敛计数===1）；**注意**：该脚本自清 `bsync_op_log` 与 `bsync_snapshots`（测试账号专用）
5. **口径修正**：meta 无 type 字段（0017 注释的 `type='bookmark'` 统计口径不成立）→ used_count 改为客户端上报「可见树 url 非空节点数」

---

## 6. 关键操作手册（复现环境）

```bash
cd /home/user/Doubao/chats/38441509014479362/bookmark-sync

# 1. 单测
npx vitest run                      # 92/92 全绿

# 2. 打包（先 build 再 firefox）
pnpm package                        # extension/（Chromium）
pnpm build:firefox                  # extension-firefox/（Firefox）

# 3. 双设备 E2E（需要 Xvfb :99 已启动）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/e2e-two-device.mjs
# 前置：DISPLAY=:99 Xvfb；脚本自带自清理（杀残留 Chromium + 清 profile + TRUNCATE op_log）

# 3b. 快照 GC E2E（P3：三端，自清 op_log + snapshots）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' node e2e/e2e-gc.mjs

# 4. Firefox 单端 smoke（需先 pnpm build:firefox）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/ff-smoke.mjs

# 5. Chromium × Firefox 跨浏览器双端（P1 验收）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/e2e-ff-sync.mjs

# 6. 推送迁移（改 supabase/ 子模块后）
cd supabase && SUPABASE_ACCESS_TOKEN=$(cat ~/.supabase_access_token) /home/user/.local/bin/supabase db push
# 子模块单独提交推送（git -c user.name=catnuko ...），主仓再 add supabase 记录指针

# 7. git 提交（全局未配身份，必须带 -c）
git -c user.name=catnuko -c user.email=catnuko@users.noreply.github.com commit -m "..."
git push origin refactor/plan
```

### 环境坑（必读）
- **测试二进制**：`/opt/browser/chrome`（进程名 `chrome`），不是 `/usr/local/bin/chromium`；清理用 `ps -eo pid,args | grep "e2e/.profiles"`
- **Firefox**：`/home/user/tools/ff/firefox/firefox` + geckodriver `/home/user/tools/geckodriver`；profile `e2e/.ff-profiles/<port>`；清理用 `grep "e2e/.ff-profiles"`（脚本会自清理，勿手动 rm 未退出的 profile——fuse EBUSY）
- **fuse 文件**：profile 下 `.fuse*` 在进程存活时 EBUSY，杀进程后轮询等归零再 `rm -rf`
- **CDP 保活**：调试器连接会阻止 SW 闲置终止，测冷重启须先断开/关页面
- **headless 不可用**：必须 DISPLAY=:99（有头 Xvfb），`--headless=new` 下扩展 SW 加载不稳
- **Supabase schema**：禁直接 DDL，改 schema 先写子模块 `migrations/00XX` 再 `supabase db push`（CLI 用 `/home/user/.local/bin/supabase`，npx wrapper 缺 linux-x64 二进制勿用）
- **GC E2E 注意**：`e2e-gc.mjs` 会 TRUNCATE `bsync_snapshots`（测试账号专用）；op_log 与快照按 space_id 隔离，但 TRUNCATE 是全表
- **git 身份**：全局未配置，提交必须带 `-c user.name=catnuko -c user.email=catnuko@users.noreply.github.com`
- **Firefox 桥端口**：9455（桥页面 server）/ 9444（geckodriver）/ 9446（BiDi WS）；残留进程会占端口导致脚本卡死，先 `ps -eo pid,args | grep -E "ff-smoke|e2e-ff|ffbridge|geckodriver"` 清理

---

## 7. 建议的新会话第一个动作

1. 读本文件 → 跑 `npx vitest run` 确认基线（92/92）→ `git log --oneline -3` 确认最新提交
2. **P0/P1/P2/P3 全部完成，Firefox 书签菜单已参与同步，Edge 三端联合验证通过**。剩余可选后续：
   - Safari 验证与产物同步适配
   - GC 阈值默认值（当前 2000）按真实使用量调优；快照版本化（schema 演进）
   - used_count 上报时机（当前每次 runSync 后）
3. 每完成一个任务提交一次（分支 refactor/plan），验收标准见各任务
