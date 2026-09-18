# Bookmark Sync —— 应用商店资料

> 用途：上传 Chrome Web Store（developer.chrome.com）与 Firefox AMO（addons.mozilla.org）时，按字段复制下方内容。

---

## 1. 软件包中的标题

```
Bookmark Sync
```

支持邮件：support@bookmark-sync.top
网站：https://www.bookmark-sync.top


## 2. 软件包中的摘要（≤132 字符）

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

· 免费起步，无需信用卡：免费计划即可同步 500 条书签，功能与付费版完全一致；需要更大容量时随时升级。

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
答：可以。免费 500 条书签，同步能力与付费版完全一致。

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

· Free to start, no credit card: The free plan syncs up to 500 bookmarks with full functionality; upgrade whenever you need more capacity.

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
A: Yes. The free plan includes 500 bookmarks with the same sync capabilities as paid plans.

Q: How do I restore bookmarks on a new device?
A: Install the extension → sign in with the same account → enter the same sync passphrase, and your full bookmark tree is pulled automatically.

Q: Is my bookmark data secure?
A: All bookmark operations are encrypted on your device before upload. The server stores only ciphertext, so your data cannot be read even if leaked.

## 4. 类别 / 语言（表单下拉）

| 字段 | 值 |
|---|---|
| 类别 | 工具 |
| 语言 | 中文（中国） |

## 5. 商店图标

- 尺寸：128 × 128 像素（PNG）
- 说明：建议与扩展内图标一致（见 `store-assets/` 或 `public/icons/icon-128.png`）

## 6. 其他商店字段（供填写时参考）

| 字段 | 值 |
|---|---|
| 主页（Homepage URL） | https://www.bookmark-sync.top |
| 支持信息页面网址（Support page URL） | **https://www.bookmark-sync.top/support** |
| 隐私政策（Privacy Policy URL） | https://www.bookmark-sync.top/privacy |
| 支持邮箱 | support@bookmark-sync.top |

> 支持页已新建（/support，含联系邮箱 + FAQ + 资源链接），部署后即可访问；若官网尚未部署该版本，可先用支持邮箱 `support@bookmark-sync.top` 兜底。

## 7. Firefox AMO 补充

- AMO 的 **Summary**（≤250 字符）：使用第 2 节的推荐摘要（英文版）：

```
Cross-browser bookmark sync for Chrome / Edge / Firefox with end-to-end encryption. Keep one bookmark tree across all your devices.
```

- AMO 的 **Detailed Description**：复制第 3.1 节中文说明（或 3.2 英文说明）。AMO 支持 Markdown/HTML，可直接粘贴。

> 注意：AMO 审核还需提交**源码包**（打包 `src/` + `package.json`），产物 zip 见 GitHub Release v2.2.0。
