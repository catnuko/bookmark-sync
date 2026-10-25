# Bookmark Sync —— 应用商店资料

> 用途：上传 Chrome Web Store（developer.chrome.com）与 Firefox AMO（addons.mozilla.org）时，按字段复制下方内容。

标题：Bookmark Sync
支持邮件：support@bookmark-sync.top
网站：https://www.bookmark-sync.top

## 2. 软件包中的摘要（≤132 字符）

> ★ **2026-10-25 起上传用的文案真源是 `store-listing.json`**（同目录），本节的 §2 / §3.1 / §3.2 / §7 保留为人读版说明，不再被 `scripts/update-amo-listing.mjs` 读取。改文案请改 JSON，别只改这里。

**推荐（有卖点）**

```
跨 Chrome / Edge / Firefox 的书签云同步：端到端加密，多设备保持同一棵书签树
```

**备选（当前已填，简短）**

```
通过 Supabase 在 Chrome / Edge / Firefox 间同步书签
```

## 3. 说明（详细描述，≤16,000 字符）

### 3.1 中文版说明（复制本段）

Bookmark Sync 让 Chrome、Edge、Firefox 三款浏览器的书签汇成同一棵树——装上扩展、登录同一账号，任意一台设备上的增删改与整理都会自动同步到其他浏览器。无需手动导出导入，无需自建服务器。

【主要特性】

· 跨浏览器同步：Chrome / Edge / Firefox 之间双向同步书签与文件夹。在一台设备上整理，其他设备自动更新。

· 真树结构同步：按书签树的真实结构同步，而不是拍平的路径字符串。重命名文件夹、移动、重排，子项与层级完整保留，顺序在所有设备上保持一致，不再出现「一改名整层子项全丢」。

· 端到端加密，默认开启：每一条书签操作都在你的设备上加密后才上传（AES-256-GCM），服务器只保管密文，任何第三方（包括服务商）都无法读取你的书签内容。设置一个同步口令即可：新设备登录同一账号并输入同一口令，即可解密同步，无需记忆长长的密钥。

· 多端合并，互不覆盖：两台设备同时增、删、改时自动合并，各自的新增都保留，不会互相覆盖或误删；离线期间做的修改，联网后照样合并。

· 删除不复活：删除以「墓碑」跨设备传播，A 设备删掉的书签不会因别处的旧数据在 B 设备复活。

· 多空间隔离：可创建多个空间，将工作与生活的书签分开管理，每个空间独立同步、互不干扰。

· 设备管理：自动登记参与同步的浏览器，可查看、重命名或解除绑定，随时控制哪些设备继续同步。

· 免费起步，无需信用卡：免费计划即可同步 1,000 条书签，功能与付费版完全一致；需要更大容量时随时升级。

【隐私与安全】

· 端到端加密默认开启，服务器无法读取书签内容
· 仅收集登录邮箱与同步所需的最小数据
· 隐私政策：https://www.bookmark-sync.top/privacy

【常见问题】

问：需要注册吗？
答：需要。使用邮箱 + 密码注册，登录后设置同步口令即可开始同步。

问：支持哪些浏览器？
答：Chrome、Edge、Firefox（Manifest V3）。Safari 暂不支持。

问：免费版能用吗？
答：可以。免费 1,000 条书签，同步能力与付费版完全一致。

问：如何在新设备上恢复书签？
答：安装扩展 → 登录同一账号 → 输入同一同步口令，完整书签树自动拉取。

问：我的书签数据安全吗？
答：所有书签操作在设备上加密后才上传，服务器只保存密文，即使数据泄露也无法被读取。

### 3.2 英文版说明（复制本段，用于「所有语言」→ English）

Bookmark Sync merges the bookmarks of Chrome, Edge, and Firefox into one tree. Install the extension, sign in with the same account, and any changes you make on one device sync automatically to your other browsers—no manual import/export, no self-hosted server required.

【Key Features】

· Cross-browser sync: Two-way bookmark and folder sync between Chrome / Edge / Firefox. Organize on one device, and your other browsers update automatically.

· True tree-structure sync: Syncs the real bookmark tree instead of flattened path strings. Renaming folders, moving, and reordering keeps every child item and level intact, with consistent ordering across all devices.

· End-to-end encryption by default: Every bookmark operation is encrypted on your device before upload (AES-256-GCM). The server only stores ciphertext, so no third party—including the service provider—can read your bookmarks. Set one sync passphrase and enter it on a new device to decrypt and sync.

· Conflict-free merging: Concurrent add/edit/delete from two devices merge automatically; both sides' additions are kept, and offline changes merge once back online.

· Deletions never resurrect: Deletions propagate across devices as tombstones, so bookmarks removed on one device never reappear from stale data elsewhere.

· Multiple spaces: Create separate spaces to keep work and personal bookmarks apart, each synced independently.

· Device management: Registered browsers are listed for review; rename or unbind any device at any time.

· Free to start, no credit card: The free plan syncs up to 1,000 bookmarks with full functionality; upgrade whenever you need more capacity.

【Privacy & Security】

· End-to-end encryption enabled by default; the server cannot read your bookmark content
· Collects only your login email and the minimum data needed for sync
· Privacy policy: https://www.bookmark-sync.top/privacy

【FAQ】

Q: Do I need an account?
A: Yes. Register with email + password, then set a sync passphrase to start syncing.

Q: Which browsers are supported?
A: Chrome, Edge, and Firefox (Manifest V3). Safari is not supported yet.

Q: Can I use the free plan?
A: Yes. The free plan includes 1,000 bookmarks with the same sync capabilities as paid plans.

Q: How do I restore bookmarks on a new device?
A: Install the extension → sign in with the same account → enter the same sync passphrase, and your full bookmark tree is pulled automatically.

Q: Is my bookmark data secure?
A: All bookmark operations are encrypted on your device before upload. The server stores only ciphertext, so your data cannot be read even if leaked.

## 4. 类别 / 语言（表单下拉）

| 字段 | 值           |
| ---- | ------------ |
| 类别 | 工具         |
| 语言 | 中文（中国） |

## 5. 商店图标

- 尺寸：128 × 128 像素（PNG）
- 说明：建议与扩展内图标一致（见 `store-assets/` 或 `public/icons/icon-128.png`）

### 5.1 商店宣传图左侧文案（唯一真相源）

> 用途：`store-assets/<lang>/1280x800/*` 与 `store-assets/<lang>/1400x560/*` 左侧那 4 条卖点 pill。
> **改图先改这里**，不要只改图片 —— 图片是手工素材（无生成脚本），文案漂移了没人会发现。

| # | 中文 | English | 对应官网对比矩阵维度（`website/src/lib/compare.ts`） |
|---|------|---------|------------------------------------------------------|
| 1 | 端到端加密 · AES-256-GCM | End-to-end encryption · AES-256-GCM | 端到端加密 |
| 2 | 注册即用 · 无需自建服务器 | Sign up and sync · no server to run | 无需自建服务器 |
| 3 | 并发自动合并 · 无需人工处理 | Auto-merge · no manual conflict work | 冲突全自动收敛，无需人工处理 |
| 4 | 免费 1,000 条书签 · 永久免费 | 1,000 bookmarks free · forever | 免费档 |

**第 3 条是核心卖点**，不要退回成「多设备合并」这类所有同步工具都能说的话 —— 区别在于别人（Floccus / XBrowserSync）的冲突处理会要求用户重做、关 failsafe 或清重复，我们不需要。完整论证见官网 `/explain/bookmark-sync-vs-alternatives`。

**★ 2026-10-25 撤掉的旧第 3 条「多设备合并 · 兼容原生同步」**：与实现不符，有误导风险。代码里没有任何原生同步兼容/避让逻辑（`grep nativeSync|profileSync|原生同步 src/` 零命中）；多设备合并的前提是**每台设备都装了扩展**（见 `article-en.md` 第 5 节），一台装扩展、另一台用浏览器自带同步时，两套系统同写一棵书签树、冲突由浏览器裁决，不在我们的控制范围内 —— 症状正是「删掉的书签又回来了」，而这是官网在讲别人毛病时举的例子。官网文章统一建议「只留一套同步引擎」（`website/src/content/*/edge-to-chrome-bookmarks.md`），宣传图不能反着说。

**改动涉及的文件**（3 张图 × 2 语言 = 6 个）：

```
store-assets/zh/1280x800/screenshot-1280x800-auth.{png,jpg}
store-assets/zh/1280x800/screenshot-1280x800-main.{png,jpg}
store-assets/zh/1400x560/marquee-promo-tile-1400x560.{png,jpg}
store-assets/en/1280x800/screenshot-1280x800-auth.{png,jpg}
store-assets/en/1280x800/screenshot-1280x800-main.{png,jpg}
store-assets/en/1400x560/marquee-promo-tile-1400x560.{png,jpg}
```

**改图注意事项（pill 宽度）**：四条长度都有变化，需重新对齐 pill 宽度，不要照抄旧图的宽度。

| # | 中文 字数 旧→新 | 英文 字符 旧→新 |
|---|-----------------|-----------------|
| 1 | 19 → 19（不变） | 35 → 35（不变） |
| 2 | 21 → 14（变短） | 40 → 35（变短） |
| 3 | 14 → 15（略长） | 35 → 36（略长） |
| 4 | 11 → 19（**明显变长**） | 24 → 30（**明显变长**） |

第 4 条变化最大 —— 中文从「免费套餐 · 永久免费」扩成「免费 1,000 条书签 · 永久免费」，英文同理。1280×800 与 1400×560 的左栏宽度够，但要确认不换行、不与右侧窗口重叠。

`440x280` 小图块只有 logo 无文案，不受影响。

## 6. 其他商店字段（供填写时参考）

| 字段                                 | 值                                        |
| ------------------------------------ | ----------------------------------------- |
| 主页（Homepage URL）                 | https://www.bookmark-sync.top             |
| 支持信息页面网址（Support page URL） | **https://www.bookmark-sync.top/support** |
| 隐私政策（Privacy Policy URL）       | https://www.bookmark-sync.top/privacy     |
| 支持邮箱                             | support@bookmark-sync.top                 |

> 支持页已新建（/support，含联系邮箱 + FAQ + 资源链接），部署后即可访问；若官网尚未部署该版本，可先用支持邮箱 `support@bookmark-sync.top` 兜底。

## 7. Firefox AMO 补充

- AMO 的 **Summary**（≤250 字符）：使用第 2 节的推荐摘要（英文版）：

```
Cross-browser bookmark sync for Chrome / Edge / Firefox with end-to-end encryption. Keep one bookmark tree across all your devices.
```

- AMO 的 **Detailed Description**：复制第 3.1 节中文说明（或 3.2 英文说明）。AMO 支持 Markdown/HTML，可直接粘贴。

> 注意：AMO 审核还需提交**源码包**。每次 Release 已自动附带 `bookmark-sync-source-<ver>.zip`（由 `scripts/package-source.mjs` 生成，内含可复现构建的最小源码集 + `BUILD.md` 构建说明），到对应 tag 的 GitHub Release 下载后直接上传即可，无需手工打包。

## 8. 测试说明（Chrome Web Store → 测试说明）

> 用途：Chrome 开发者控制台「访问权限 → 测试说明」表单。扩展登录后还有口令门禁，必须把口令一并给出，否则审核员会卡在登录后进不去主界面。

[用户名：bsync-e2e@example.com](mailto:用户名：bsync-e2e@example.com)，密码：yhUYLzxlgL4z3v_zoKEiyRhs，口令：bsync-e2e-passphrase-2026

**凭证（专用测试账号，非日常账号）：**

| 字段   | 值                                    |
| ------ | ------------------------------------- |
| 用户名 | `bsync-e2e@example.com`               |
| 密码   | `yhUYLzxlgL4z3v_zoKEiyRhs`            |
| 口令   | `bsync-e2e-passphrase-2026`（门禁用） |

**其他说明（英文，可直接粘贴）：**

```
This is a dedicated test account with sample bookmarks pre-synced. After signing in, the extension requires a sync passphrase to unlock the interface. Enter: bsync-e2e-passphrase-2026
```

> 账号维护：由 `scripts/e2e/create-account.mjs` 创建/修复（幂等；会同步密码、补 identity、把 plan 提为 pro），云端已验证 email 已确认、可登录。此账号仅供测试，勿用于真实书签数据。

## 9. 权限申请说明（Chrome Web Store → 隐私权 → 权限）

> 用途：Chrome 开发者控制台「隐私权 → 单一用途 / 需请求权限的理由」表单。以下英文文案为页面实际填写内容（均已通过字符数校验，可直接复制）。

**manifest 声明（`public/manifest.json` / `public/manifest.firefox.json`）：**

```json
"permissions": ["bookmarks", "storage", "alarms"],
"host_permissions": ["https://*.supabase.co/*"]
```

**单一用途说明（Single purpose，116/1,000）：**

```
This extension keeps a user's browser bookmarks synchronized across browsers and devices with end-to-end encryption.
```

**需请求 bookmarks 的理由（214/1,000）：**

```
The extension uses the bookmarks API to read, create, update, move, and delete the user's bookmarks and folders, so that changes made in one browser are synchronized to all of the user's other browsers and devices.
```

**需请求 storage 的理由（197/1,000）：**

```
The extension uses the storage API to persist local sync state, the pending operation queue, and encryption settings, so synchronization resumes reliably after browser restarts and offline periods.
```

**需请求 alarms 的理由（202/1,000）：**

```
The extension uses the alarms API to schedule background sync retries, ensuring pending bookmark operations are delivered to the server and applied on other devices even after the browser has been idle.
```

**需请求主机权限的理由（207/1,000）：**

```
The extension needs host permissions for the Supabase domain (https://*.supabase.co/*) to reach its sync backend, where encrypted bookmark operations are uploaded and downloaded. No other hosts are accessed.
```

**各权限用途（中文，便于核对）：**

| 权限                                  | 用途                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `bookmarks`                           | 读取/增删改书签树，是同步的主体数据                            |
| `storage`                             | 本地缓存同步状态、待发队列、加密设置等（chrome.storage.local） |
| `alarms`                              | 定时触发后台同步重试，保证离线期间的操作最终送达               |
| `https://*.supabase.co/*`（主机权限） | 访问 Supabase 同步后端，上传/下载加密书签操作；仅此一个主机    |

> 说明：
>
> - Chrome 提示：涉及主机权限可能导致深入审核与发布延迟，属预期情况，无需移除（该权限为实现同步必需）。
> - 付费订阅在官网（www.bookmark-sync.top）通过 Creem 完成，扩展本身不访问支付域名，因此主机权限不含官网域名。
