# bookmark-sync

Chrome 与 Safari 书签同步工具：自建 FastAPI + SQLite 同步服务器，配合双端通用浏览器扩展（Manifest V3）。

## 结构

- `server/` — 同步服务器（推送/拉取/墓碑/URL 去重）
- `extension/` — 浏览器扩展，一套代码同时用于 Chrome 和 Safari（经 `safari-web-extension-converter` 转换）

## 部署

```bash
cd server
pip install -r requirements.txt
SYNC_TOKEN=你的密钥 uvicorn main:app --host 0.0.0.0 --port 8000
```

Chrome：`chrome://extensions` → 开发者模式 → 加载 `extension/` → 在扩展选项页填服务器地址和密钥。

Safari：`xcrun safari-web-extension-converter extension/ --project-location ~/Projects/BookmarkSync --app-name BookmarkSync`，用 Xcode 编译运行后在 Safari 中启用。
