# 端到端测试（真实 Chromium + Firefox + Supabase）

在**真实浏览器**里验证同步链路（单测覆盖不到的：MV3 Service Worker 生命周期、
chrome.bookmarks 事件、Supabase 网络往返、popup/SW realm 隔离、跨浏览器差异）。

---

# 一、本地通道 `run.mjs`（macOS / Linux，日常用这个）

把你反复手测的那几条流程固化成可重跑的场景。一台"设备" = 一个独立
`user-data-dir` + 一个调试端口 + 一份扩展实例，**不碰你日常 Chrome 的任何数据**。

```bash
npx vite build                       # 必须先产出 extension/
cp scripts/e2e/e2e.env.example .workbuddy/e2e.env   # 填入测试账号（该文件已被 gitignore）

node scripts/e2e/run.mjs list                        # 列出场景
node scripts/e2e/run.mjs phrase-gate                 # 跑场景（云端必须已是干净起点）
node scripts/e2e/run.mjs two-device-sync --fresh --allow-destroy --cleanup
node scripts/e2e/run.mjs reset                       # 只复位（云端 + 本机 profile）
node scripts/e2e/run.mjs clean                       # 只杀残留 Chrome + 删 profile
npm run e2e -- <场景>                                # 同一个入口
```

## 场景

| 场景              | 锁死的回归点                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `phrase-gate`     | 首设备**设**口令、新设备**验**口令；错口令报 `gate_errWrong` 且回滚密钥/盐；同口令两台设备**派生出的密钥逐字节相同** |
| `bind-gate`       | 新设备挡出**不可关闭的整页门禁**；用户选非默认空间时真的绑那一个；**同账号重登不再问一遍**；跨空间隔离               |
| `two-device-sync` | A 建「文件夹 + 2 书签」→ B 逐条重现（含父子关系）→ B 删 → **A 上也消失**（墓碑生效）；云端 op 全密文 + 无明文泄漏    |

## 参数

| 参数              | 作用                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `--fresh`         | 跑前复位该测试账号的云端同步数据（op / 快照 / 设备 / 空间 / 盐）                     |
| `--allow-destroy` | **第二把钥匙**：云端还有 op 时，`--fresh` 必须再加它才肯删（防顺手清掉手工测试数据） |
| `--cleanup`       | **默认开启**：跑完复位云端 + 本机 profile（场景中途抛错也生效）。显式写出来只是重申  |
| `--no-cleanup`    | 跑完**不**复位，保留现场排障                                                         |
| `--headed`        | 有头模式，看着它自己点（排障用）                                                     |
| `--keep-profiles` | 保留 profile，便于复现现场                                                           |
| `--ext=<dir>`     | 指定扩展产物目录（默认 `<repo>/extension`）                                          |

未给 `--fresh` 而云端不干净时，场景**显式失败并告诉你该加什么参数**——不给空洞的绿。

## 配置（`.workbuddy/e2e.env`，已被 gitignore）

`E2E_EMAIL` / `E2E_PASSWORD` 必填；`E2E_PASSPHRASE` 可选（默认一串专门给测试用的口令）。
`E2E_PASSPHRASE` 只用于测试账号——`--fresh` 会把账号的 E2EE 盐清掉，换盐后旧口令
解不开历史数据。

## 用真实 Google Chrome 加载未打包扩展（两条硬约束）

Chrome 137+ 移除了品牌版的 `--load-extension`，只能走 CDP：

1. 启动参数要带 `--enable-unsafe-extension`，然后发 CDP 命令
   `Extensions.loadUnpacked { path }`；
2. **千万不要加 `--disable-extensions-except`**：它会把 CDP 加载进来的未打包扩展
   限制成「已加载但未启用」，`loadUnpacked` 正常返回了扩展 id，但 `/json/list` 里
   永远没有 `background.js`——SW 不启动，整个 E2E 卡在第一步。已用二分法定位
   （8 组参数 × 2 次，只有带这个开关的那两组稳定失败）。

另外两个已经在 harness 里处理掉的坑：

- **启动竞态**：上一轮被 `SIGKILL` 的 Chrome 会留下僵尸实例，新一轮的扩展 SW 起不来。
  `launchDevice` 启动前清端口（`lsof -ti tcp:<port>`）+ 加载后**主动唤醒**（打开一次
  `chrome-extension://<id>/popup.html`，把"等"变成"推"）+ 失败自动重试一次。
- **popup 只开一个**：唤醒用的那个 tag 直接复用成 popup 句柄。同一 profile 里挂两个
  popup 页会各跑一份 `init()`，互相干扰。

## 其它已知坑

- **Vue v-model**：CDP 直接设 `input.value` 会被 Vue 忽略（按钮一直 disabled），
  脚本用 `Input.insertText` 真实键盘输入，并回读校验。
- **同步必须由扩展页面发消息触发**：SW 是同步权威（事件桥与 coordinator 同 realm），
  在页面上下文直接跑同步会另建一份 CRDT 状态。`device.triggerSync()` 走的就是
  `chrome.runtime.sendMessage({type:'bsync-sync'})`。
- **书签 id 是每台设备各自的**：跨设备操作前先从目标设备的树里取 id（`two-device-sync`
  里踩过：拿 A 的 id 去 B 上删会删错/删不掉）。
- **断言文案取自扩展自己的 i18n**（`chrome.i18n.getMessage`），脚本里不另抄一份中文
  ——抄一份会在改文案时静默失配，测试仍然绿。
- **断言不抛异常**：每一步记一条结果（ok/fail/info），跑完一次性打印，退出码由 fail
  条数决定。抛异常只能看到第一个错，而排障时最想看"哪几步坏了、坏成什么样"。
- **危险出口要两把钥匙**：`--fresh` 删非空云端数据需要再加 `--allow-destroy`；
  profile 目录只按 `--user-data-dir=<本 harness 的 profileRoot>` 匹配清理，
  绝不误伤日常 Chrome。
- **「清不干净」不等于「跑不起来」**：一个 Chrome profile 有上千个文件，批量递归删除
  可能被环境拦下（企业策略 / 沙箱 / 权限）。此时 harness **不报错**，而是换一个全新的目录
  `.profiles/<设备名>.<ts>/`——干净 profile 的效果一样，只是旧目录留在磁盘上。
  `run.mjs clean` 一删到底（`.profiles/` 整棵树，包含这些轮换目录）。

## 失败时怎么看

报告落在 `scripts/e2e/.reports/<场景>-<时间>.json`（已 gitignore），含每条断言的
detail 与 `extra`（账号、空间 id、op 数、marker 标题等）。终端输出里 `✗` 那行会把
**实际值**带上（比如"仍停在门禁页 / 错误文案: xxx"），不用回看代码猜。

遗留未做：**换绑 / 绑定空间被删**场景（`doRebindSpace` 的"清空本机 + 重建"链路）。

---

# 二、旧 Linux 通道（历史脚本，保留）

以下脚本是早期在 Linux 容器里跑的版本，**不使用**上面的 `run.mjs`：依赖 Xvfb、
`--load-extension`、Supabase Management API token（非本地 CLI）。

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

| 脚本                            | 验证内容                                                                                                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e-single.mjs`                | 单设备闭环：登录 → 同步 → 建书签 → op_log 增长 → **op 全为 AES-GCM 密文信封**                                                                                                                                                                                                                |
| `e2e-two-device.mjs`            | **双 Chromium 双向同步**：A 建书签 → B 拉到并 reverseApply 写回本机 chrome → B 建书签 → A 拉到 → 双端收敛 + **场景 3（SW 冷重启保留）**                                                                                                                                                      |
| `ff-smoke.mjs`                  | **Firefox 单端**：桥通道 login → sync → create → getTree（根 guid 适配验证）                                                                                                                                                                                                                 |
| `e2e-ff-sync.mjs`               | **Chromium × Firefox 跨浏览器双向同步（P1+P3 验收）**：A1/B1 各恰 1 个、op_log 恰 2 条；**书签菜单同步**（Firefox `menu________` ↔ Chromium「书签菜单」文件夹，M1/M2 各恰 1）                                                                                                                |
| `e2e-triple-sync.mjs`           | **三浏览器联合验证（P3 验收）**：Chromium × Firefox × Edge 三方收敛（A1/B1/C1 各端各恰 1）+ 菜单双向（Firefox menu ↔ Chromium/Edge 菜单文件夹）+ Edge 场景3 冷重启保留。Edge 二进制 `EDGE_BIN`（默认 `/home/user/tools/msedge/opt/microsoft/msedge/msedge`，Chromium 系复用 launchChromium） |
| `e2e-gc.mjs`                    | **快照 + op-log GC（P3 验收，Chromium×3）**：A 建书签同步触发 GC（注入 `crdt.gcThreshold=1`）→ op_log 截断 + 快照落库 → C 新设备从快照重建收敛 → GC 后增量仍通 → 终态计数===1                                                                                                                |
| `supabase-check.mjs [--detail]` | 只读：查空间/设备/op_log 数量与密文结构                                                                                                                                                                                                                                                      |

## 运行

```bash
EMAIL=你的测试账号邮箱 PASSWORD='你的密码' node e2e/e2e-single.mjs
EMAIL=你的测试账号邮箱 PASSWORD='你的密码' node e2e/e2e-two-device.mjs
EMAIL=你的测试账号邮箱 PASSWORD='你的密码' E2E_RESET=1 node e2e/ff-smoke.mjs
EMAIL=你的测试账号邮箱 PASSWORD='你的密码' E2E_RESET=1 node e2e/e2e-ff-sync.mjs
EMAIL=你的测试账号邮箱 PASSWORD='你的密码' node e2e/e2e-triple-sync.mjs   # 三浏览器（Chromium×Firefox×Edge，含菜单双向 + Edge 场景3）
EMAIL=你的测试账号邮箱 PASSWORD='你的密码' node e2e/e2e-gc.mjs   # 自清 op_log + bsync_snapshots（测试账号专用）
```

结束浏览器：`bash e2e/kill-chromium.sh`（或自行 kill；Firefox 脚本自带清理）。

## 环境变量

| 变量                 | 默认                                  | 说明                                                 |
| -------------------- | ------------------------------------- | ---------------------------------------------------- |
| `EMAIL` / `PASSWORD` | 必填                                  | Supabase 登录账号                                    |
| `E2E_RESET`          | —                                     | `1` 时先 `TRUNCATE bsync_op_log`（测试账号专用）     |
| `CHROME_BIN`         | `/usr/local/bin/chromium`             | 浏览器二进制（真实环境实际是 `/opt/browser/chrome`） |
| `EXT_DIR`            | `<repo>/extension`                    | 要加载的扩展目录                                     |
| `CDP_PORT`           | `9345`                                | 单设备脚本端口（双设备用 9345/9346）                 |
| `PROFILE_DIR`        | `<repo>/e2e/.profiles/<port>`         | Chromium profile                                     |
| `FF_BIN`             | `/home/user/tools/ff/firefox/firefox` | Firefox 二进制                                       |
| `GECKODRIVER_BIN`    | `/home/user/tools/geckodriver`        | geckodriver 路径                                     |
| `SUPABASE_PROJECT`   | `cwtqnsbpcetvqopdkcou`                | 项目 ref                                             |
| `DISPLAY`            | `:99`                                 | Xvfb 显示号                                          |

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
    `bsync-test-bridge@test.local`，命令 ping/sync/login/logout/storage._/bookmarks._）。
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
