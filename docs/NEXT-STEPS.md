# 交接文档：bookmark-sync Move-CRDT 重构 — 下一步任务

> 用途：新会话接续任务的唯一入口。先读本文件，再按「快速开始」复现环境，然后从「任务清单」继续。
> 生成时间：2026-09-14 · 分支：`refactor/plan`（最新 commit `416bf69`）

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

### 2.4 本会话修复（commit 待提交）
| 修复 | 说明 |
|---|---|
| **reverseApply 回环 bug（根因）** | `sync.js` `reverseApplyIntoChrome` 事件守卫写错层级：`guard.value = true` 给 `{suppressed:{value}}` 外层加新属性，事件闭包读的 `suppressed.value` 从未置位 → 守卫静默失效 → reverseApply 每次建书签都被 onCreated 捕获成新 op 推回云端 → 对端再 reverseApply → **每次同步复制一批书签**（曾实测 A 侧 A1×3、op_log 13 条）。修复为 `guard.suppressed.value = true/false`。op_log 从 11-13 降到 2（仅 A1+B1 create），双端各恰有 1 个 |
| 冷启动 idMap 竞态防御 | `getOrCreateBridge()` 的 idMap 恢复改为可 await 的 `_idMapReady`，`runSync` reverseApply 前、`seedExistingTree` 前 `await ensureBridgeReady()`：防 SW 冷启动后 reverseApply 在 idMap load 完成前把已有书签当缺失重建 |
| 场景 3 改优雅重启 | `e2e-two-device.mjs` 场景 3：`chrome.runtime.reload()` → SIGTERM 优雅关闭 → 等 CDP 端口/进程退出 → 同 profile 重启 → onStartup 自动 sync（kill -9 会损坏 profile 扩展状态 → ERR_BLOCKED_BY_CLIENT） |
| e2e 计数断言 | 收敛断言从「存在性」升级为「计数 === 1」（A1/B1 各恰有 1 个），防回环类回归 |

---

## 3. 当前状态（验证结果）

- ✅ `npx vitest run`：80/80 全绿
- ✅ 标准双设备 E2E：远端写回 + 双向同步 PASS（多次）
- ✅ 打包：`pnpm package` 通过（extension/ 含最新逻辑，background.js 含 `bsync-sync` 消息通道）
- ✅ **场景 3（SW 冷重启保留）真实环境 PASS**：改为「SIGTERM 优雅关闭 → 同 profile 重启」（`chrome.runtime.reload()` 在本 Chromium 146 构建中 reload 后 SW 无法被事件唤醒，弃用）。3 次连跑稳定：`SW 重启: true` + `保留 A1/B1: true true`（A1×1, B1×1），op_log 仅 2 条（无回环垃圾）
- ✅ **修复 reverseApply 回环 bug**（重要，见 2.4）：`reverseApplyIntoChrome` 的事件守卫写错层级——`guard.value = true` 实际设置的是 `{suppressed:{value}}` 外层的新属性，事件闭包读的 `suppressed.value` 从未被置位 → reverseApply 每次建书签都触发 onCreated 回环成新 op → 每次同步复制一批书签（A 树曾出现 A1×3）。修复为 `guard.suppressed.value = true/false`。另加冷启动 idMap 恢复等待（`ensureBridgeReady`，防 reverseApply 在 idMap load 完成前把已有书签当缺失重建）
- ✅ e2e 断言加强：收敛从「存在性」升级为「计数 === 1」（防回环回归）

---

## 4. 任务清单（新会话从这里继续）

### ✅ P0 — 冷重启真实环境验证（已完成）
- **结果**：场景 3 改为「SIGTERM 优雅关闭 → 同 profile 重启」，`SW 重启: true` + `保留 A1/B1: true true`，3 次连跑稳定，exit=0
- **附带修复**：reverseApply 回环 bug（守卫层级写错，见 2.4）+ 冷启动 idMap 竞态
- 后续若换 Chrome 稳定版，可回归 `chrome.runtime.reload()` 路径（README 已记录）

### 🟠 P1 — Firefox 跨浏览器同步（用户点名，见第 5 节）
- **目标**：A=Chromium、B=Firefox，同一 Supabase 后端双向同步
- **前置**：下载 Firefox + geckodriver；适配 e2e 驱动（Firefox 无 CDP，用 WebDriver BiDi / Marionette）
- **验收**：B（Firefox）树出现 A 的书签，反向亦然，收敛 true（计数各 === 1）

### 🟡 P2 — 收敛收尾（部分完成）
- ✅ 场景 3 并入主脚本后跑通 3 次（防 flaky）
- ✅ `e2e/README.md` 写入已知限制（SW 重启模拟方式、Firefox 差异）
- ✅ `docs/refactor-plan.md` 状态列更新（C 阶段完成，剩余 P1/P3）

### 🟢 P3 — 产品化缺口（调研/设计，不阻塞）
- `bsync_snapshots` 表启用（快照 + GC，防 op_log 无限增长）
- 操作级 E2EE 的密钥导入 UI（新设备加入流程）
- 与原生 Chrome Sync 共存策略（建议 UI 提示二选一）

---

## 5. Firefox 跨浏览器测试 — 可行性结论（可直接回答用户）

**可行，且项目已有基础**。结论与依据：

1. **代码已备好**：`pnpm build:firefox` 生成 `extension-firefox/`（`scripts/build-firefox.mjs`），manifest 换成 Firefox 版：
   - `background: { scripts: ["background.js"], type: "module" }`（Firefox MV3 用事件页语义，不支持 `service_worker` 字段）
   - `browser_specific_settings.gecko.id = bookmark-sync@bookmarksync.app`，strict_min_version 109（Firefox 109+ 支持 MV3）
2. **API 兼容**：`chrome.bookmarks` / `chrome.storage.local` / `chrome.alarms` 在 Firefox 均有（Firefox 的 `chrome.*` 命名空间兼容）；Supabase 走 fetch，无平台差异
3. **必须适配的部分（工作量 ~半天）**：
   - **驱动层**：现有 `e2e/lib/cdp.mjs` 基于 CDP（Chromium 专有）。Firefox 需 **geckodriver + WebDriver BiDi**（Firefox 129+ 默认开启）或 Marionette（端口 2828）。要写 `launchFirefox()` + 一套 BiDi eval 封装
   - **扩展加载**：Firefox 用 `--profile <dir>` + 预置 `extensions.autoDisableScopes=0` 或用 `about:debugging` 临时加载；加载方式与 Chromium 的 `--load-extension` 不同
   - **popup URL**：Firefox 是 `moz-extension://<uuid>/popup.html`（不是 chrome-extension://），且扩展 id 在临时加载时每次可能变化
   - **storage 注入**：E2EE 密钥注入改用 `moz-extension://` 页面 eval
4. **环境**：Linux 下载 Firefox tarball（Mozilla 官方）或 `apt install firefox-esr`；geckodriver 从 GitHub releases 下载；同样跑在 Xvfb `:99`
5. **建议测试矩阵**：A=Chromium（现有）、B=Firefox 一设备即可验证跨浏览器；后续可扩展 Chrome/Edge/Firefox 三端

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

# 4. git 提交（全局未配身份，必须带 -c）
git -c user.name=catnuko -c user.email=catnuko@users.noreply.github.com commit -m "..."
git push origin refactor/plan
```

### 环境坑（必读）
- **测试二进制**：`/opt/browser/chrome`（进程名 `chrome`），不是 `/usr/local/bin/chromium`；清理用 `ps -eo pid,args | grep "e2e/.profiles"`
- **fuse 文件**：profile 下 `.fuse*` 在进程存活时 EBUSY，杀进程后轮询等归零再 `rm -rf`
- **CDP 保活**：调试器连接会阻止 SW 闲置终止，测冷重启须先断开/关页面
- **headless 不可用**：必须 DISPLAY=:99（有头 Xvfb），`--headless=new` 下扩展 SW 加载不稳
- **Supabase schema**：禁直接 DDL，改 schema 先写子模块 `migrations/0018` 再 `supabase db push`
- **git 身份**：全局未配置，提交必须带 `-c user.name=catnuko -c user.email=catnuko@users.noreply.github.com`

---

## 7. 建议的新会话第一个动作

1. 读本文件 → 跑 `npx vitest run` 确认基线 → `git pull` 确认 416bf69
2. 做 P0（冷重启真实验证，方案 A 优雅关闭重启）
3. 做 P1（Firefox）：先装 Firefox + geckodriver，写 `e2e/lib/launchFirefox.mjs` + BiDi 封装，复用现有场景脚本骨架
4. 每完成一个任务提交一次（分支 refactor/plan），验收标准见各任务
