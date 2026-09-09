# bookmark-sync

Chrome 与 Safari 书签同步工具：Supabase（Postgres）作为后端，配合双端通用浏览器扩展（Manifest V3），扩展直连 Supabase 无需自建服务器。

## 结构

- `supabase/migrations/` — 数据库迁移脚本（`bsync_bookmarks` / `bsync_sync_secret` 表 + RLS + RPC 函数 `bsync_sync_push` / `bsync_sync_pull`，统一 `bsync_` 前缀与库内其他项目隔离）
- `extension/` — 浏览器扩展，一套代码同时用于 Chrome 和 Safari（经 `safari-web-extensions-converter` 转换）

## 部署

### 1. 初始化 Supabase

在 [Supabase Dashboard](https://supabase.com/dashboard) 中打开项目，进入 SQL Editor，执行 `supabase/migrations/0001_init.sql`。

执行前，把脚本里 `bsync_sync_secret` 表中的 `token` 值替换成你自己的同步密钥：

```sql
insert into public.bsync_sync_secret (k, v)
values ('token', '你的同步密钥')
on conflict (k) do nothing;
```

如果没有项目，先在 Supabase 新建一个，并把 `extension/sync.js` 里的 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY` 更新为自己的项目值。

### 2. 加载扩展

Chrome：`chrome://extensions` → 开发者模式 → 加载 `extension/` → 在扩展选项页填写与上面一致的「同步密钥」。

Safari：`xcrun safari-web-extension-converter extension/ --project-location ~/Projects/BookmarkSync --app-name BookmarkSync`，用 Xcode 编译运行后在 Safari 中启用。

## 说明

- 数据隔离：`bsync_sync_push` / `bsync_sync_pull` 为 `security definer` 函数，只有持有正确 `token` 才能读写数据；前端 publishable key（`anon` 角色）无法直接访问表。
- 同步协议：快照 diff + 单调递增版本号增量拉取 + 服务端按 URL 去重。