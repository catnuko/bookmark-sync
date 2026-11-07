# bookmark-sync

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)](LICENSE)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/users/emmjhpmhfepapemiflddnbmikicklfml?logo=googlechrome&logoColor=white&label=Chrome)](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml)
[![Edge Add-ons](https://img.shields.io/badge/Edge%20Add--ons-Install-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah)
[![Firefox Add-ons](https://img.shields.io/amo/users/bookmark-sync-app?logo=firefoxbrowser&logoColor=white&label=Firefox)](https://addons.mozilla.org/firefox/addon/bookmark-sync-app)

**你的书签，处处一致，且默认隐私。** 跨浏览器书签云同步扩展（Manifest V3）：端到端加密 + CRDT 无冲突同步。可直接使用托管服务（**Chrome / Edge / Firefox**），也可以把整套后端部署在自己的 Supabase 上。

[English](README.md) | 简体中文

## 为什么做 bookmark-sync

浏览器自带的书签同步通常把你锁进单一生态：Chrome 只同步 Google 账号，Edge 只同步微软账号，彼此互不相通——而且它们会把你的完整浏览数据交给别人的云。bookmark-sync 让所有设备、所有浏览器上的书签保持一致，且每条数据在离开你的设备前就已加密，代码完全开源，可以自行审查，也可以完全自托管。

## 功能特性

- **跨浏览器、跨设备。** 一个账号同步 Chrome、Edge、Firefox 上的所有电脑——这些浏览器彼此之间本来是不能互相同步的。
- **端到端加密默认开启。** 每一条书签操作在设备上加密（AES-256-GCM）后才上传，服务器只见密文。密钥由你的口令派生，任何人（包括我们）都读不到你的书签。
- **无冲突同步（CRDT）。** 两台设备同时改同一条书签？两边改动都会保留。内部实现上，每次新建/移动/删除都是分布式操作日志里的一条小操作（Move-CRDT，与协同编辑文档同源的技术），所有设备各自独立运算都会收敛到完全一致的结果——不丢书签、没有合并弹窗、不存在「以谁为准」。
- **隐私优先。** 服务器只存加密数据和运行服务所需的最少元数据——绝不存书签内容、网址或文件夹名。服务器能看见什么、看不见什么，见 [docs/PRIVACY.md](docs/PRIVACY.md) 与[官网隐私政策](https://www.bookmark-sync.top/zh/privacy)。

## 安装

推荐直接从商店安装你所用浏览器的版本，更新自动处理：

| 浏览器  | 安装                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| Chrome  | [Chrome 应用商店](https://chromewebstore.google.com/detail/emmjhpmhfepapemiflddnbmikicklfml)                    |
| Edge    | [Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/bookmark-sync/ilhfggggmdgfnliiimnkhdbaijjombah) |
| Firefox | [Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/bookmark-sync-app)                             |

Safari 暂不支持——它不提供 `bookmarks` API，扩展侧书签同步在 Safari 上当前不可行。

## 自托管

想完全自己掌控？整套后端——数据库迁移、认证、存储——可以跑在你自己的 Supabase 项目上，扩展也可以构建为指向你自己的实例。见 [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)。自托管实例**不使用**托管服务的订阅计费，额度由你自己配置。

## 价格（托管服务）

托管服务免费档为每账号 **1,000 条 / 5 MiB**，更高额度提供付费档（Plus / Pro / Lifetime）。自托管则由你自己决定额度。细节可能调整，扩展内始终展示你当前的档位与用量。

## 反馈与贡献

- 发现问题或有建议？[提一个 issue](https://github.com/catnuko/bookmark-sync/issues)。
- 想贡献代码？请先读 [CONTRIBUTING.md](CONTRIBUTING.md)——提交需带 `Signed-off-by`（`git commit -s`，[DCO](https://developercertificate.org/)），提交信息遵循 Conventional Commits。
- 发现安全漏洞请**不要开公开 issue**，私密上报渠道见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
pnpm install
pnpm dev            # 本地预览选项页 / 弹窗 UI
pnpm build          # Chromium 构建 -> extension/
pnpm build:firefox  # Firefox 构建 -> extension-firefox/
pnpm check          # 类型检查 + lint + 格式检查 + 单测
```

- `src/` —— 扩展源码（选项页、弹窗、Service Worker、同步引擎）
- `supabase/` —— 数据库迁移（`bsync_*` 表 + RPC）
- `website/` —— 官网（Next.js，Vercel 部署，独立依赖树）
- `scripts/` —— 构建钩子、打包与本地验证脚本

在浏览器中加载本地构建：`chrome://extensions` → 开发者模式 → 加载已解压 → `extension/`（Firefox：`about:debugging` → 临时载入附加组件 → `extension-firefox/manifest.json`）。

## 许可证

本项目**永久免费开源**，以 [GNU Affero 通用公共许可证 v3.0 或更新版本](LICENSE)（AGPL-3.0-or-later）发布，覆盖扩展、Supabase 后端（迁移 + edge functions）、官网与仓库内全部脚本。

## Star 历史

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=catnuko/bookmark-sync&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=catnuko/bookmark-sync&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=catnuko/bookmark-sync&type=Date" />
</picture>
