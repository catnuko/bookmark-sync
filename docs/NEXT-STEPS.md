# 交接文档：bookmark-sync Move-CRDT 重构 — 下一步任务

> 用途：新会话接续任务的唯一入口。先读本文件，再按「快速开始」复现环境，然后从「任务清单」继续。
> 生成时间：2026-09-14 · 分支：`refactor/plan`（最新 commit `66f62fb` + P1 Firefox 适配待提交）

---

## 1. 项目全景

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/catnuko/bookmark-sync（私有） |
| 开发分支 | `refactor/plan`（**禁止直接改 main**） |
| Supabase 子模块 | `supabase/` → catnuko/supabase-snaply-multi（main，迁移水位 **0017**） |
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
| **Firefox 特殊根不播种** | `sync.js` `seedExistingTree` 跳过 `FIREFOX_ROOT_IDS`（root/menu/toolbar/unfiled/mobile）：否则 `menu________` 被当普通节点播种 → reverseApply 试图 `chrome.move(menu 根)` → `"The bookmark root cannot be modified"` |
| **menu________ 暂不同步** | Firefox 书签菜单根不映射 CRDT 固定根（产品限制：菜单书签不同步，reverseApply 不动它）；测试建书签用 `toolbar_____` |
| **postMessage 测试桥** | Firefox WebDriver 禁止导航/跳转 `moz-extension://`（about:blank 与 http 页 location.href 均被拦）。`e2e/test-bridge/`（id `bsync-test-bridge@test.local`）content script 用 `window.postMessage` 桥（Firefox 内容脚本↔页面标准通道，结构化克隆无 Xray 问题）转发 `onMessageExternal` 白名单命令（`src/testChannel.js`） |
| **桥方案死路（勿重试）** | wrappedJSObject 赋函数（Xray Permission denied）；`Cu.exportFunction`（页面调用仍 Permission denied，参数/返回值跨 realm 克隆受限）；DOM CustomEvent 跨 realm（内容脚本收不到页面事件）；WebDriver 导航 moz-extension://（含 http 页跳转） |
| 测试脚本 | `e2e/ff-smoke.mjs`（Firefox 单端：login→sync→create→getTree）、`e2e/e2e-ff-sync.mjs`（跨浏览器双端）、`e2e/lib/{bidi,launchFirefox,ffbridge}.mjs`、`e2e/test-bridge/` |

---

## 3. 当前状态（验证结果）

- ✅ `npx vitest run`：80/80 全绿
- ✅ 标准双设备 E2E：远端写回 + 双向同步 PASS（多次）
- ✅ 打包：`pnpm package` 通过（extension/ 含最新逻辑，background.js 含 `bsync-sync` 消息通道）
- ✅ **场景 3（SW 冷重启保留）真实环境 PASS**：改为「SIGTERM 优雅关闭 → 同 profile 重启」（`chrome.runtime.reload()` 在本 Chromium 146 构建中 reload 后 SW 无法被事件唤醒，弃用）。3 次连跑稳定：`SW 重启: true` + `保留 A1/B1: true true`（A1×1, B1×1），op_log 仅 2 条（无回环垃圾）
- ✅ **修复 reverseApply 回环 bug**（重要，见 2.4）：`reverseApplyIntoChrome` 的事件守卫写错层级——`guard.value = true` 实际设置的是 `{suppressed:{value}}` 外层的新属性，事件闭包读的 `suppressed.value` 从未被置位 → reverseApply 每次建书签都触发 onCreated 回环成新 op → 每次同步复制一批书签（A 树曾出现 A1×3）。修复为 `guard.suppressed.value = true/false`。另加冷启动 idMap 恢复等待（`ensureBridgeReady`，防 reverseApply 在 idMap load 完成前把已有书签当缺失重建）
- ✅ **P1 Firefox 跨浏览器同步 PASS**（见 2.5）：`e2e/e2e-ff-sync.mjs` 2 次连跑，Chromium↔Firefox 双向收敛 true、op_log 恰 2 条；`ff-smoke.mjs` 单端 PASS；Chromium 双端回归 PASS。核心修复：跨浏览器根 id 适配（backward 按环境）、Firefox 特殊根不播种、postMessage 测试桥

---

## 4. 任务清单（新会话从这里继续）

### ✅ P0 — 冷重启真实环境验证（已完成）
- **结果**：场景 3 改为「SIGTERM 优雅关闭 → 同 profile 重启」，`SW 重启: true` + `保留 A1/B1: true true`，3 次连跑稳定，exit=0
- **附带修复**：reverseApply 回环 bug（守卫层级写错，见 2.4）+ 冷启动 idMap 竞态
- 后续若换 Chrome 稳定版，可回归 `chrome.runtime.reload()` 路径（README 已记录）

### ✅ P1 — Firefox 跨浏览器同步（已完成）
- **验收**：A=Chromium、B=Firefox 双向同步收敛 true（计数各 === 1），`e2e/e2e-ff-sync.mjs` 2 次连跑全绿；`ff-smoke.mjs` 单端、`e2e-two-device.mjs` 回归均 PASS
- **核心适配**：Firefox 根 guid 体系（`backward` 按环境 seed，详见 2.5）、Firefox 特殊根不播种、postMessage 测试桥
- **已知限制**：Firefox `menu________`（书签菜单）暂不参与同步；测试建书签用 `toolbar_____`

### 🟡 P2 — 收敛收尾（完成）
- ✅ 场景 3 并入主脚本后跑通 3 次（防 flaky）
- ✅ `e2e/README.md` 写入已知限制（SW 重启模拟方式、Firefox 差异）
- ✅ `docs/refactor-plan.md` 状态列更新（C 阶段完成）
- ✅ P1 基础设施提交：`e2e/lib/{bidi,launchFirefox,ffbridge}.mjs`、`e2e/test-bridge/`、`src/testChannel.js`、`e2e/{ff-smoke,e2e-ff-sync}.mjs`

### 🟢 P3 — 产品化缺口（调研/设计，不阻塞）
- `bsync_snapshots` 表启用（快照 + GC，防 op_log 无限增长）
- 操作级 E2EE 的密钥导入 UI（新设备加入流程）
- 与原生 Chrome Sync 共存策略（建议 UI 提示二选一）

---

## 5. Firefox 跨浏览器测试 — 已实现（结论与实测要点）

**P1 已完成并验收通过**（见 2.5）。实现要点：

1. **构建**：`pnpm build:firefox` 生成 `extension-firefox/`（manifest 换 Firefox 版：`background.scripts` 事件页语义 + `browser_specific_settings.gecko.id = bookmark-sync@bookmarksync.app`）
2. **API 兼容**：`chrome.bookmarks` / `chrome.storage.local` 在 Firefox 均有；Supabase 走 fetch，无平台差异
3. **驱动层（已落地）**：
   - `e2e/lib/launchFirefox.mjs`：geckodriver 0.36 + WebDriver BiDi（`--port=9444 --websocket-port=9446`，9222 被环境浏览器占用必须换端口；capability 需显式 `webSocketUrl: true`）；扩展用 classic 端点 `POST /session/{sid}/moz/addon/install`（`moz:install-temporary-extension` capability 在 0.36 不可用）；扩展 UUID 用 pref `extensions.webextensions.uuids` 固定
   - **Firefox 无法 WebDriver 导航到 `moz-extension://`**（about:blank 与 http 页 location.href 跳转均被安全策略拦）→ **测试桥**：`e2e/test-bridge/`（id `bsync-test-bridge@test.local`）content script 用 **`window.postMessage`** 桥（内容脚本↔页面标准通道）转发到 bookmark-sync 的 `onMessageExternal` 白名单通道（`src/testChannel.js`，仅 ping/sync/login/logout/storage.*/bookmarks.*）
   - **死路（勿重试）**：wrappedJSObject 赋值函数、`Cu.exportFunction`、DOM CustomEvent 跨 realm、WebDriver/JS 跳转 moz-extension://
4. **环境**：Firefox 155.0.1 @ `/opt/ff/firefox/firefox`（官方 tarball，代理 `http://127.0.0.1:8118` 下载）；geckodriver 0.36 @ `/home/user/tools/geckodriver`；Xvfb `:99`
5. **测试矩阵（已覆盖）**：A=Chromium ↔ B=Firefox 双端；`ff-smoke.mjs` 单端；后续可扩展三端

---

## 6. 关键操作手册（复现环境）

```bash
cd /home/user/Doubao/chats/38441509014479362/bookmark-sync

# 1. 单测
npx vitest run                      # 80/80 全绿

# 2. 打包（先 build 再 firefox）
pnpm package                        # extension/（Chromium）
pnpm build:firefox                  # extension-firefox/（Firefox）

# 3. 双设备 E2E（需要 Xvfb :99 已启动）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/e2e-two-device.mjs
# 前置：DISPLAY=:99 Xvfb；脚本自带自清理（杀残留 Chromium + 清 profile + TRUNCATE op_log）

# 4. Firefox 单端 smoke（需先 pnpm build:firefox）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/ff-smoke.mjs

# 5. Chromium × Firefox 跨浏览器双端（P1 验收）
EMAIL=346746061@qq.com PASSWORD='Qzy123456' E2E_RESET=1 node e2e/e2e-ff-sync.mjs

# 6. git 提交（全局未配身份，必须带 -c）
git -c user.name=catnuko -c user.email=catnuko@users.noreply.github.com commit -m "..."
git push origin refactor/plan
```

### 环境坑（必读）
- **测试二进制**：`/opt/browser/chrome`（进程名 `chrome`），不是 `/usr/local/bin/chromium`；清理用 `ps -eo pid,args | grep "e2e/.profiles"`
- **Firefox**：`/opt/ff/firefox/firefox` + geckodriver `/home/user/tools/geckodriver`；profile `e2e/.ff-profiles/<port>`；清理用 `grep "e2e/.ff-profiles"`（脚本会自清理，勿手动 rm 未退出的 profile——fuse EBUSY）
- **fuse 文件**：profile 下 `.fuse*` 在进程存活时 EBUSY，杀进程后轮询等归零再 `rm -rf`
- **CDP 保活**：调试器连接会阻止 SW 闲置终止，测冷重启须先断开/关页面
- **headless 不可用**：必须 DISPLAY=:99（有头 Xvfb），`--headless=new` 下扩展 SW 加载不稳
- **Supabase schema**：禁直接 DDL，改 schema 先写子模块 `migrations/0018` 再 `supabase db push`
- **git 身份**：全局未配置，提交必须带 `-c user.name=catnuko -c user.email=catnuko@users.noreply.github.com`
- **Firefox 桥端口**：9455（桥页面 server）/ 9444（geckodriver）/ 9446（BiDi WS）；残留进程会占端口导致脚本卡死，先 `ps -eo pid,args | grep -E "ff-smoke|e2e-ff|ffbridge|geckodriver"` 清理

---

## 7. 建议的新会话第一个动作

1. 读本文件 → 跑 `npx vitest run` 确认基线 → `git pull` 确认最新（66f62fb + P1 提交）
2. P0/P1/P2 均已完成。剩余 P3（产品化缺口，调研/设计，不阻塞）：
   - `bsync_snapshots` 表启用（快照 + GC，防 op_log 无限增长）
   - 操作级 E2EE 的密钥导入 UI（新设备加入流程）
   - 与原生 Chrome Sync 共存策略（建议 UI 提示二选一）
   - 可选：Firefox `menu________` 根参与同步；更多浏览器矩阵
3. 每完成一个任务提交一次（分支 refactor/plan），验收标准见各任务
