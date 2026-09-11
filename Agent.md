# Agent.md — bookmark-sync 开发注意事项

给后续开发/维护的 agent 看的要点。**源目录即真相**（`src/`），构建产物目录（`extension/`、`extension-firefox/`）都在 `.gitignore`，不要直接改，也不要提交。

## 1. 构建与产物（三浏览器，Safari 暂不做）

- Chrome / Edge：同一份产物。`npx vite build` → `extension/`（同时拷入 `public/manifest.json`），manifest 在 zip 根目录。
- Firefox：`node scripts/build-firefox.mjs` = 拷贝 `extension/` → `extension-firefox/` 并**替换成 `public/manifest.firefox.json`**（`background.scripts` + `options_ui` + `browser_specific_settings.gecko.id`）。
- 注意：`pnpm build` = `vite build && node scripts/post-build-safari.mjs`，会顺带同步并尝试编译 Xcode Safari 工程 —— **CI 里不要用 `pnpm build`**，要分别跑 `npx vite build` + `node scripts/build-firefox.mjs`。
- 每个 Release 产出两个 zip：`bookmark-sync-chromium-<ver>.zip`、`bookmark-sync-firefox-<ver>.zip`。

## 2. CI 发版（`.github/workflows/release.yml`）

自动闭环：改代码（约定式提交）→ push main → release-please 自动升版本 + 生成 CHANGELOG.md + 开 release PR → 合并 PR → 自动打 tag + 建 Release + 构建上传两个 zip。流程已实测通过（v0.1.0）。

要点（踩过的坑，勿回退）：
- `permissions` 必须 `contents: write` + **`pull-requests: write`**，否则 release-please 建 PR 报 "Resource not accessible by integration"。
- 仓库设置需开启 **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**。
- `pnpm/action-setup@v4` 必须给 `version: 10`，否则报 "No pnpm version is specified"。
- 不用 `pnpm build`（理由见上）。
- **`release-as: 0.1.0` 是临时锁定**，首个 v0.1.0 发布成功后应删除该行及注释；否则以后每次都是 0.1.0 不再自动升级。
- release-please 按 Conventional Commits 定版本：`fix:` → patch，`feat:` → minor，`BREAKING CHANGE` → major。**提交信息不带前缀会被归到 patch/忽略**。
- 当前 package.json version = 0.1.0（开发期版本），首个正式版前别急着升 1.0。
- `gh` CLI 用 `GH_TOKEN` 登录（git push 需先 `gh auth setup-git`），但该 token 无 workflow dispatch 权限，触发工作流用 push 事件即可。

## 3. ★ Safari 硬约束（暂缓，勿投入）

- Safari（macOS + iOS）**不支持 `bookmarks` API**（Apple 2011 移除、2020 未实现，至今不支持），项目同步逻辑无降级分支 → 在 Safari 上「立即同步」必失败。macOS blocked 只能靠原生 App 直读写 `~/Library/Safari/Bookmarks.plist`（需关 App Sandbox + 完全磁盘访问，无法上 Mac App Store）；iOS 只能经 iCloud 中转（手机不够，Safari 书签不可读）。
- 因此**当前发布范围仅 Chrome / Edge / Firefox，Safari 不参与**。

## 4. 同步协议（快照 + 墓碑，并集合并）

- 新增 = 并集（任一设备有而服务端没有的都保留）；删除 = 墓碑传播（粘性删除，不复活）；重加 = 原删除设备获胜（墓碑带持久随机 `deviceId`）。
- 迁移脚本须按 `0001 → 0007` 顺序执行（`0005_tombstones.sql` 开头 drop 旧签名重写 RPC）。
- 本地验证：`scripts/verify-sync-local/`（setup.sql + scenario.sql），psql 退出码 3 = 最后「未登录应报错」的预期错误触发 ON_ERROR_STOP，**不是失败**。
- 数据强调 RLS 行级隔离，登录态存 `chrome.storage.local`。

## 5. 商店发布注意

- 三家商店都要求公开隐私政策 URL（`https://bookmarksync.app/privacy`）。
- AMO：`manifest.firefox.json` 已声明 `data_collection_permissions`（邮箱/书签/PII）；审核要交**源码包**（打包 `src/`+`package.json`），产物是压缩 bundle；`gecko.id` 一经提交不可改。
- Chrome/Edge 提交 `extension/` 的 zip。

## 6. 与用户协作约定

- 改代码前先对齐方案，不自动 commit/push（需明确授权）。
- 视觉验证以截图对照参考实现为准。
- 本文件是开发注意事项，README 才是面向部署/发布的完整说明。