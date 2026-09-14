# 端到端测试（真实 Chromium + Supabase）

在**真实浏览器**里验证同步链路（单测覆盖不到的：MV3 Service Worker 生命周期、
chrome.bookmarks 事件、Supabase 网络往返、popup/SW realm 隔离）。

## 前置

```bash
pnpm package            # 产出 extension/（脚本加载这个目录）
echo "sbp_你的token" > ~/.supabase_access_token   # Supabase Management API token（查 op_log 用）
# Xvfb（Linux 无头环境必需）：
Xvfb :99 -screen 0 1440x900x24 &
```

## 脚本

| 脚本 | 验证内容 |
|---|---|
| `e2e-single.mjs` | 单设备闭环：登录 → 同步 → 建书签 → op_log 增长 → **op 全为 AES-GCM 密文信封** |
| `e2e-two-device.mjs` | **双浏览器双向同步**：A 建书签 → B 拉到并 reverseApply 写回本机 chrome → B 建书签 → A 拉到 → 双端收敛 |
| `supabase-check.mjs [--detail]` | 只读：查空间/设备/op_log 数量与密文结构 |

## 运行

```bash
EMAIL=346746061@qq.com PASSWORD='你的密码' node e2e/e2e-single.mjs
EMAIL=346746061@qq.com PASSWORD='你的密码' node e2e/e2e-two-device.mjs
```

结束浏览器：`bash e2e/kill-chromium.sh`（或自行 kill）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `EMAIL` / `PASSWORD` | 必填 | Supabase 登录账号 |
| `CHROME_BIN` | `/usr/local/bin/chromium` | 浏览器二进制 |
| `EXT_DIR` | `<repo>/extension` | 要加载的扩展目录 |
| `CDP_PORT` | `9345` | 单设备脚本端口（双设备用 9345/9346） |
| `PROFILE_DIR` | `<repo>/e2e/.profiles/<port>` | 浏览器 profile（登录态持久化，可复用） |
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

## 跨浏览器（Firefox）差异（P1 进行中）

- 现有 `lib/cdp.mjs` 基于 CDP（Chromium 专有）；Firefox 需 **geckodriver +
  WebDriver BiDi**（或 Marionette 2828 端口）驱动。
- 扩展加载：Firefox 用 `--profile <dir>` + `extensions.autoDisableScopes=0` 预置，
  或 `about:debugging` 临时加载，不是 Chromium 的 `--load-extension`。
- popup URL 是 `moz-extension://<uuid>/popup.html`（非 chrome-extension://），
  临时加载时扩展 id 每次可能变化，storage 注入需按实际 id 定位。
