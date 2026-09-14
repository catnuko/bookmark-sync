# 端到端测试（真实 Chromium + Firefox + Supabase）

在**真实浏览器**里验证同步链路（单测覆盖不到的：MV3 Service Worker 生命周期、
chrome.bookmarks 事件、Supabase 网络往返、popup/SW realm 隔离、跨浏览器差异）。

## 前置

```bash
pnpm package            # 产出 extension/（Chromium，脚本加载这个目录）
pnpm build:firefox      # 产出 extension-firefox/（Firefox）
echo "sbp_你的token" > ~/.supabase_access_token   # Supabase Management API token（查 op_log 用）
# Xvfb（Linux 无头环境必需）：
Xvfb :99 -screen 0 1440x900x24 &
# Firefox 环境（P1）：
/home/user/tools/ff/firefox/firefox                          # Firefox 155.0.1（官方 tarball，代理下载）
/home/user/tools/geckodriver                     # geckodriver 0.36.0
```

## 脚本

| 脚本 | 验证内容 |
|---|---|
| `e2e-single.mjs` | 单设备闭环：登录 → 同步 → 建书签 → op_log 增长 → **op 全为 AES-GCM 密文信封** |
| `e2e-two-device.mjs` | **双 Chromium 双向同步**：A 建书签 → B 拉到并 reverseApply 写回本机 chrome → B 建书签 → A 拉到 → 双端收敛 + **场景 3（SW 冷重启保留）** |
| `ff-smoke.mjs` | **Firefox 单端**：桥通道 login → sync → create → getTree（根 guid 适配验证） |
| `e2e-ff-sync.mjs` | **Chromium × Firefox 跨浏览器双向同步（P1+P3 验收）**：A1/B1 各恰 1 个、op_log 恰 2 条；**书签菜单同步**（Firefox `menu________` ↔ Chromium「书签菜单」文件夹，M1/M2 各恰 1） |
| `e2e-triple-sync.mjs` | **三浏览器联合验证（P3 验收）**：Chromium × Firefox × Edge 三方收敛（A1/B1/C1 各端各恰 1）+ 菜单双向（Firefox menu ↔ Chromium/Edge 菜单文件夹）+ Edge 场景3 冷重启保留。Edge 二进制 `EDGE_BIN`（默认 `/home/user/tools/msedge/opt/microsoft/msedge/msedge`，Chromium 系复用 launchChromium） |
| `e2e-gc.mjs` | **快照 + op-log GC（P3 验收，Chromium×3）**：A 建书签同步触发 GC（注入 `crdt.gcThreshold=1`）→ op_log 截断 + 快照落库 → C 新设备从快照重建收敛 → GC 后增量仍通 → 终态计数===1 |
| `supabase-check.mjs [--detail]` | 只读：查空间/设备/op_log 数量与密文结构 |

## 运行

```bash
EMAIL=346746061@qq.com PASSWORD='你的密码' node e2e/e2e-single.mjs
EMAIL=346746061@qq.com PASSWORD='你的密码' node e2e/e2e-two-device.mjs
EMAIL=346746061@qq.com PASSWORD='你的密码' E2E_RESET=1 node e2e/ff-smoke.mjs
EMAIL=346746061@qq.com PASSWORD='你的密码' E2E_RESET=1 node e2e/e2e-ff-sync.mjs
EMAIL=346746061@qq.com PASSWORD='你的密码' node e2e/e2e-gc.mjs   # 自清 op_log + bsync_snapshots（测试账号专用）
```

结束浏览器：`bash e2e/kill-chromium.sh`（或自行 kill；Firefox 脚本自带清理）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EMAIL` / `PASSWORD` | 必填 | Supabase 登录账号 |
| `E2E_RESET` | — | `1` 时先 `TRUNCATE bsync_op_log`（测试账号专用） |
| `CHROME_BIN` | `/usr/local/bin/chromium` | 浏览器二进制（真实环境实际是 `/opt/browser/chrome`） |
| `EXT_DIR` | `<repo>/extension` | 要加载的扩展目录 |
| `CDP_PORT` | `9345` | 单设备脚本端口（双设备用 9345/9346） |
| `PROFILE_DIR` | `<repo>/e2e/.profiles/<port>` | Chromium profile |
| `FF_BIN` | `/home/user/tools/ff/firefox/firefox` | Firefox 二进制 |
| `GECKODRIVER_BIN` | `/home/user/tools/geckodriver` | geckodriver 路径 |
| `SUPABASE_PROJECT` | `cwtqnsbpcetvqopdkcou` | 项目 ref |
| `DISPLAY` | `:99` | Xvfb 显示号 |

## 已知坑（真实环境验证过）

- **必须 Xvfb 有头模式**：`--headless=new` 下扩展 SW 加载不稳定。
- **Vue v-model**：CDP 直接设 input.value 会被 Vue 忽略导致按钮 disabled，脚本用
  `Input.insertText` 真实键盘输入。
- **profile 复用**：`.profiles/` 保留登录态；想干净重测删对应目录即可。
- **SW 权威**：同步必须由 popup 发消息触发 SW 内 runSync（`bsync-sync`），
  直接在 popup 上下文调同步会在独立 ESM realm 里建另一份 CRDT 状态。

## 场景 3（SW 冷重启）模拟方式

- **整进程优雅重启（当前实现）**：对浏览器进程发 `SIGTERM` → 等 CDP 端口关闭 +
  进程退出（fuse 文件释放）→ 同 profile 重新 `launchChromium` → `onStartup` 自动
  sync。**不要用 `kill -9`**：会损坏 profile 扩展状态，重启后扩展被
  `ERR_BLOCKED_BY_CLIENT` 禁用。
- **`chrome.runtime.reload()` 不可用**（本 Chromium 146 构建已知缺陷）：reload 后
  SW 无法被事件唤醒（45s 无 target）。若换 Chrome 稳定版可回归 reload 路径。
- **CDP 保活**：调试器连接会阻止 SW 闲置终止；测"SW 被回收"场景须先断开 CDP。

## 跨浏览器（Firefox）— 已实现（P1 通过）

驱动链路：`geckodriver + WebDriver BiDi`（`e2e/lib/bidi.mjs`），Firefox 无 CDP。

- **扩展加载**：classic 端点 `POST /session/{sid}/moz/addon/install`（`temporary: true`），
  返回 manifest 声明的 id `bookmark-sync@bookmarksync.app`；`moz:install-temporary-extension`
  capability 在 geckodriver 0.36 报 `Unrecognised option`（勿用）。
- **扩展 UUID 固定**：pref `extensions.webextensions.uuids` =
  `{"bookmark-sync@bookmarksync.app":"11111111-..."}`（临时加载 id 否则随机）。
- **WebDriver 不能导航到 `moz-extension://`**（about:blank 与 http 页 location.href
  跳转均被 Firefox 安全策略拒绝）→ **测试桥**：
  - `src/testChannel.js`：产品侧 `runtime.onMessageExternal` 白名单通道（仅 sender
    `bsync-test-bridge@test.local`，命令 ping/sync/login/logout/storage.*/bookmarks.*）。
  - `e2e/test-bridge/`：桥扩展 content script 用 **`window.postMessage`** 桥（内容脚本↔
    页面标准通道，结构化克隆无 Xray 问题）把页面消息转发到 bookmark-sync。
  - **死路（勿重试）**：wrappedJSObject 赋值函数 / `Cu.exportFunction` / DOM CustomEvent
    跨 realm / WebDriver 与 JS 跳转 moz-extension://（全部失败，见 NEXT-STEPS.md 2.5）。
- **根 id 差异**：Chrome 根是数字 `"0"/"1"/"2"/"3"`，Firefox 是 guid
  `root________/toolbar_____/unfiled_____/mobile______`（另有 `menu________`）。
  `chromeBridge.ts` 的 backward（uuid→chromeId）**只 seed 本环境根**（UA 判定
  `IS_FIREFOX`）；两环境都 seed 会被后写覆盖 → Chromium 下 `toChromeId(OTHER)` 返回
  Firefox guid → `"Bookmark id is invalid."`。`menu________` 暂不同步。
- **端口**：9455（桥页面 server）/ 9444（geckodriver）/ 9446（BiDi WS，9222 被环境
  浏览器占用须换端口）；残留进程占端口会卡死，先清理。
