# bookmark-sync 仓库审计与重构方案

> 版本：v1.0（2026-09-14）
> 状态：C 阶段（Move-CRDT 重构）已实施并通过验证——80 单测全绿 + 真实 Chromium 双设备 E2E（远端写回 + 双向收敛 + SW 冷重启保留）多次 PASS；修复 reverseApply 事件守卫回环 bug（重复建书签）与冷启动 idMap 竞态。**P1 已完成**：Chromium × Firefox 跨浏览器双向同步 E2E 通过（根 id 适配 backward 按环境 seed、Firefox 特殊根不播种、postMessage 测试桥）。剩余：P3 产品化缺口。
> 分支：`refactor/plan`
> 范围：仅审计 + 方案，未对 `main` 做任何破坏性改动

---

## 0. 执行摘要

本仓库是已上架 AMO、有 Creem 计费的**生产扩展**（v1.1.0），同步引擎为「快照 + 墓碑 + 三态合并」，后端 Supabase。仓库存在**构建产物入库、文档不一致、无测试基建、同步引擎有已知理论短板**四类问题。

`.workbuddy/guideline.md` 已包含一份完整的「Move Tree CRDT + HLC + Op Log + 墓碑 + LexoRank + E2EE + Failsafe」理论升级方案，与 `bookmark-crdt-sync` 验证过的架构同源。

**推荐路径**：分四阶段执行——A 仓库卫生清理（低风险）→ B 结构整理（低风险）→ C 同步引擎升级为 Move-CRDT（高风险，需数据迁移）→ D 测试与 CI 基建（中风险）。C 阶段可复用 `bookmark-crdt-sync` 已验证的核心代码（Move-CRDT / IndexedDB / Merkle-DAG / AES-GCM / GC），保留 Supabase 作为加密操作日志的存储后端。

---

## 1. 审计发现

### 1.1 仓库全景

| 维度 | 事实 | 来源 |
|------|------|------|
| 版本 | v1.1.0（package.json），dist/ zip 仍为 v0.1.0（过期） | `package.json`, `dist/` |
| 已上架 | AMO（Firefox），有 Creem 计费 | 用户陈述 + `AGENTS.md` §5 |
| 扩展源码 | `src/` 8 个文件（App.vue, background.js, sync.js, crypto.js, lib/ext.js, lib/supabase.js, main.js, popup-main.js） | `src/` |
| 同步引擎 | 快照 + 墓碑 + 三态合并（LWW，删除优先） | `src/sync.js` |
| 加密 | 字段级 AES-256-GCM（仅 title/url），密钥存 chrome.storage.local，PBKDF2 固定盐 | `src/crypto.js` |
| 后端 | Supabase（Postgres + Auth + RLS），submodule 指向 `catnuko/supabase-snaply-multi`（未初始化） | `.gitmodules`, `supabase/` |
| 构建 | Vite 8 + Vue 3，多入口（options/popup/background），输出 `extension/` | `vite.config.js`, `package.json` |
| CI | release-please + 构建 Chromium/Firefox zip 上传 GitHub Release | `.github/workflows/release.yml` |
| 官网 | `website/` 独立 Vue 3 工程（Vercel 部署），有自己的 package.json/lock | `website/` |
| Safari 壳 | `bookmark-sync/` Xcode 工程（macOS/iOS App + Extension），含构建产物 | `bookmark-sync/` |
| 测试 | 无 JS 单元测试；仅有 `scripts/verify-sync-local/` 的 SQL 场景验证 | `scripts/` |
| 构建基线 | `pnpm install && npx vite build` 通过（730ms，输出 8 个文件） | 实测 2026-09-14 |

### 1.2 用户盘点核实

| # | 用户盘点 | 核实结果 | 详情 |
|---|----------|----------|------|
| ① | dist/ 压缩包已提交 | **确认** | `git ls-files dist/` 显示 2 个 zip（v0.1.0，过期）；`.gitignore` 有 `/dist/` 但文件在 gitignore 添加前已入库 |
| ② | Xcode 壳内含构建产物已提交 | **确认** | `bookmark-sync/Shared (Extension)/Resources/assets/` 下 5 个 JS/CSS（共 ~304KB）被 git 跟踪 |
| ③ | 根目录 options.html/popup.html 是 Vite 入口重复物 | **部分纠正** | 这两个文件**不是重复物**，是 Vite 多入口构建的 HTML 入口（`vite.config.js` rollupOptions.input 引用它们），各 289B，属正常结构 |
| ④ | .uploads/ 图片、.workbuddy/ 入库 | **确认** | `.uploads/` 2 张 PNG（~250KB）；`.workbuddy/` 含 guideline.md（294 行 CRDT 方案）+ memory/ + new-device-first-sync/ |
| ⑤ | 文档不一致（README 引用 Agent.md，实际 AGENTS.md） | **确认** | README 第 23、61、69 行引用 `Agent.md`，实际文件为 `AGENTS.md`（大写） |
| ⑥ | .gitignore 有 /dist/ 但 dist 文件仍在库内 | **确认** | 同① |
| ⑦ | JS 层无测试、无 lint、无 TS | **确认** | package.json 无 test/lint/typecheck 脚本；仅 SQL 验证脚本 |
| ⑧ | README 目录结构与实际不符 | **确认** | README 未提及 `bookmark-sync/`（Xcode）、`.uploads/`、`.workbuddy/`、`dist/`、`store-assets/`、`AGENTS.md` |

### 1.3 补充发现（用户未提及）

| # | 发现 | 严重度 | 详情 |
|---|------|--------|------|
| ⑨ | 根节点识别用 title 匹配而非 folderType | 中 | `src/sync.js:307-309` 用 `r.title === "Bookmarks Bar" \|\| "Bookmarks Toolbar"` 识别书签栏。Chrome 134+ 官方推荐用 `folderType` 字段，title 在本地化/重命名后可能失效 |
| ⑩ | background.js 无定时同步 | 低 | 仅 `onInstalled` + `onStartup` 触发同步，无 `chrome.alarms` 周期同步；用户需手动点 popup |
| ⑪ | PBKDF2 使用固定盐 | 中 | `src/crypto.js:25` `PBKDF2_SALT = "bookmark-sync-e2ee-v1"` 硬编码。固定盐降低了口令派生的抗彩虹表能力（虽 PBKDF2 210k 轮仍有保护） |
| ⑫ | E2EE 默认关闭 | 低 | `getEncryptMode()` 默认返回 `"plain"`，需用户手动开启。与「零信任隐私」定位有差距 |
| ⑬ | 三态合并的移动冲突用 LWW 近似 | 高 | `src/sync.js:19` 注释明确「移动冲突 → updated_at 较新者胜（可接受的近似）」。并发移动文件夹可能导致子树丢失或循环，这是 Move-CRDT 要解决的核心问题 |
| ⑭ | 无操作日志，只有快照 | 高 | 每次同步全量拉取/推送快照，无增量操作日志。离线多设备并发编辑时，三态合并只能看到最终状态，丢失操作语义 |
| ⑮ | Xcode manifest version 与 dist zip 不一致 | 低 | Xcode manifest 写 1.1.0，dist zip 是 0.1.0 |
| ⑯ | supabase submodule 未初始化 | 中 | `git submodule status` 显示 `-acfc4dc...`（前缀 `-` 表示未初始化），新 clone 无法直接看到迁移文件 |
| ⑰ | store-assets/ 入库 | 低 | 3 张商店截图/logo（~120KB），可保留但应归类 |
| ⑱ | 无 .nvmrc / engines 字段 | 低 | CI 用 Node 20，本地无版本约束文件 |

---

## 2. 混乱清单与建议动作

| # | 路径 | 问题 | 建议动作 | 阶段 |
|---|------|------|----------|------|
| 1 | `dist/*.zip` | 构建产物入库，过期（v0.1.0），.gitignore 已覆盖 | `git rm --cached dist/`，保留 .gitignore；CI 产出 zip 不入库 | A |
| 2 | `bookmark-sync/Shared (Extension)/Resources/assets/*.{js,css}` | Xcode 构建产物入库（~304KB） | `git rm --cached`，添加到 .gitignore；由 `scripts/post-build-safari.mjs` 在构建时生成 | A |
| 3 | `.uploads/*.png` | 临时图片入库（~250KB） | 移至 `docs/assets/` 或删除；添加 `.uploads/` 到 .gitignore | A |
| 4 | `.workbuddy/` | Agent 工作记忆 + 设计文档入库 | 拆分：`guideline.md` → `docs/design/crdt-upgrade-plan.md`（保留）；`memory/` → 删除或 `.gitignore`（运行时产物） | A/B |
| 5 | `README.md` 引用 `Agent.md` | 文件名错误（实际 `AGENTS.md`） | 修正为 `AGENTS.md` | A |
| 6 | `README.md` 目录结构不全 | 缺少 Xcode/.uploads/.workbuddy/dist/store-assets | 重写目录结构章节 | B |
| 7 | `store-assets/` | 商店素材无明确归类 | 保留，在 README 说明用途 | B |
| 8 | `src/sync.js` 根节点识别用 title | Chrome 134+ 应用 folderType | 改为 `getTree()` 遍历 `folderType` 字段（参考 bookmark-crdt-sync Phase 1 实现） | C |
| 9 | `src/crypto.js` PBKDF2 固定盐 | 安全加固 | 改为每用户随机盐，存 Supabase 用户元数据 | C |
| 10 | 无 JS 测试 | 质量保障缺失 | 引入 vitest，先覆盖 sync.js 合并逻辑 + crypto.js 加解密 | D |
| 11 | 无 lint/format | 代码风格不统一 | 引入 ESLint + Prettier | D |
| 12 | 无 TS | 大型同步引擎类型不安全 | 渐进式引入 TS（先 sync.js/crypto.js，或直接复用 bookmark-crdt-sync 的 TS 代码） | C/D |
| 13 | `supabase/` submodule 未初始化 | 新 clone 看不到迁移 | README 补充 `git submodule update --init` 步骤 | A |
| 14 | background.js 无定时同步 | 同步不及时 | 引入 `chrome.alarms` 周期同步（如每 30 分钟） | C |

---

## 3. 目标目录结构

```
bookmark-sync/
├── src/                          # 扩展源码（真相）
│   ├── background.js             # MV3 service worker 入口
│   ├── sync.js                   # 同步引擎（C 阶段升级为 CRDT 适配层）
│   ├── crypto.js                 # E2EE 加密层
│   ├── crdt/                     # [C 新增] 从 bookmark-crdt-sync 移植
│   │   ├── moveCrdt.ts           # Move-CRDT 核心
│   │   ├── replica.ts            # 副本状态机
│   │   ├── fractionalIndex.ts    # 同级排序
│   │   └── index.ts
│   ├── storage/                  # [C 新增] IndexedDB 持久化
│   │   ├── schema.ts
│   │   └── persistence.ts
│   ├── sync-protocol/            # [C 新增] Supabase 操作日志同步
│   │   ├── opLogStore.ts         # 操作日志表（Supabase）
│   │   └── syncClient.ts         # push/pull 增量操作
│   ├── lib/
│   │   ├── ext.js                # chrome.* API 封装
│   │   └── supabase.js           # Supabase 客户端
│   ├── App.vue                   # 选项页 Vue 根组件
│   ├── main.js                   # 选项页入口
│   └── popup-main.js             # popup 入口
├── extension/                    # [构建产物，gitignore] Chromium 输出
├── extension-firefox/            # [构建产物，gitignore] Firefox 输出
├── public/                       # manifest + 图标（构建时拷贝）
│   ├── manifest.json
│   ├── manifest.firefox.json
│   └── icons/
├── website/                      # 官网（独立工程，可考虑拆仓）
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── bookmark-sync/                # Xcode Safari 壳（构建产物 gitignore）
│   ├── Shared (App)/
│   ├── Shared (Extension)/
│   │   └── Resources/            # assets/ 由构建生成，不入库
│   ├── iOS (App)/, iOS (Extension)/
│   ├── macOS (App)/, macOS (Extension)/
│   └── bookmark-sync.xcodeproj/
├── scripts/                      # 构建钩子 + 验证脚本
│   ├── build-all.mjs
│   ├── build-firefox.mjs
│   ├── package-zips.mjs
│   ├── post-build-safari.mjs
│   └── verify-sync-local/
├── tests/                        # [D 新增] 单元测试
│   ├── sync.test.js
│   ├── crypto.test.js
│   └── crdt.test.js
├── docs/
│   ├── refactor-plan.md          # 本文档
│   ├── manual-test-plan.md
│   ├── design/
│   │   └── crdt-upgrade-plan.md  # 从 .workbuddy/guideline.md 迁移
│   └── assets/                   # 文档图片（从 .uploads/ 迁移）
├── supabase/                     # submodule（需 init）
├── .github/workflows/release.yml # CI
├── .gitignore                    # [A 更新] 补全忽略规则
├── AGENTS.md                     # 开发注意事项（修正 README 引用）
├── CHANGELOG.md
├── package.json
├── pnpm-lock.yaml
├── vite.config.js
├── options.html                  # Vite 入口（保留）
└── popup.html                    # Vite 入口（保留）
```

**不再入库**：`dist/`、`bookmark-sync/Shared (Extension)/Resources/assets/`、`.uploads/`、`.workbuddy/memory/`、`extension/`、`extension-firefox/`。

---

## 4. 分阶段执行计划

### 阶段 A：Git 卫生清理（低风险，1-2 天）

**目标**：移除构建产物和临时文件，修正文档错误，不碰源码。

| 步骤 | 操作 | 影响面 | 回滚方式 |
|------|------|--------|----------|
| A1 | `git rm --cached dist/*.zip`，确认 `.gitignore` 有 `/dist/` | 仓库减小 ~568KB | `git revert` |
| A2 | `git rm --cached "bookmark-sync/Shared (Extension)/Resources/assets/*"`，添加到 `.gitignore` | 仓库减小 ~304KB | `git revert` |
| A3 | `.uploads/` 中有价值图片移至 `docs/assets/`，其余删除；添加 `.uploads/` 到 `.gitignore` | 仓库减小 ~250KB | `git revert` |
| A4 | `.workbuddy/guideline.md` → `docs/design/crdt-upgrade-plan.md`；`.workbuddy/memory/` 删除并 `.gitignore` | 保留设计文档，移除运行时记忆 | `git revert` |
| A5 | 修正 README 中 `Agent.md` → `AGENTS.md`（3 处） | 文档 | `git revert` |
| A6 | README 补充 `git submodule update --init` 说明 | 文档 | `git revert` |
| A7 | `.gitignore` 补全：`dist/`、`Xcode assets/`、`.uploads/`、`.workbuddy/memory/` | 配置 | `git revert` |

**验收**：`git ls-files \| grep -E 'dist/\|assets/.*\.js\|.uploads/'` 无输出；README 链接正确；`pnpm build` 仍通过。

### 阶段 B：结构整理（低风险，2-3 天）

**目标**：目录分层清晰，文档与实际一致，不碰同步逻辑。

| 步骤 | 操作 | 影响面 | 回滚方式 |
|------|------|--------|----------|
| B1 | 重写 README 目录结构章节，覆盖所有实际目录 | 文档 | `git revert` |
| B2 | `store-assets/` 在 README 说明用途（商店素材） | 文档 | `git revert` |
| B3 | 添加 `.nvmrc`（Node 20，与 CI 一致）和 `package.json` engines 字段 | 配置 | `git revert` |
| B4 | 评估 `website/` 是否拆独立仓库（见决策点 2） | 架构 | 不拆则无影响 |
| B5 | 统一 `scripts/` 命名和文档 | 工具 | `git revert` |

**验收**：新 clone 按 README 步骤可完成构建；目录结构与 README 一致。

### 阶段 C：同步引擎升级（高风险，2-4 周）

**目标**：将「快照 + 三态合并」升级为「Move-CRDT + 操作日志 + 增量同步」，复用 `bookmark-crdt-sync` 已验证代码。

**核心映射**（bookmark-crdt-sync → bookmark-sync）：

| bookmark-crdt-sync 组件 | bookmark-sync 对应 | 说明 |
|-------------------------|-------------------|------|
| `src/moveCrdt.ts` (do_op/undo_op/redo_op) | `src/crdt/moveCrdt.ts` | 直接移植，算法不变 |
| `src/replica.ts` (Replica 类) | `src/crdt/replica.ts` | 直接移植 |
| `src/fractionalIndex.ts` | `src/crdt/fractionalIndex.ts` | 直接移植，替代 order 整数 |
| `src/storage/` (IndexedDB) | `src/storage/` | 直接移植 |
| `src/sync/` (Merkle-DAG + WebSocket) | **不直接用** | bookmark-sync 用 Supabase 做操作日志存储，不需要 P2P DAG |
| `src/crypto/` (AES-GCM) | `src/crypto.js` 升级 | 操作级加密替代字段级加密 |
| `src/extension/` (chrome.bookmarks 适配) | `src/sync.js` 重构 | 事件捕获 + 反向应用 |

**Supabase 作为操作日志后端**（替代 Merkle-DAG 同步层）：

```sql
-- 操作日志表（新增迁移）
CREATE TABLE bsync_op_log (
  op_id       TEXT PRIMARY KEY,        -- Lamport 时间戳 + replicaId
  space_id    UUID NOT NULL,
  replica_id  TEXT NOT NULL,
  op_data     TEXT NOT NULL,           -- 加密的 MoveOp JSON（AES-GCM）
  seq         BIGINT GENERATED ALWAYS AS IDENTITY,  -- 服务端全局递增
  created_at  TIMESTAMPTZ DEFAULT now()
);
-- 增量拉取：SELECT * FROM bsync_op_log WHERE space_id = ? AND seq > last_seq ORDER BY seq
```

- **Push**：本地新操作加密后 INSERT，幂等（op_id 去重）
- **Pull**：按 `seq > lastPulledSeq` 增量拉取，解密后 `replica.receiveOp()`
- **GC**：定期生成快照，删除快照前的操作（参考 bookmark-crdt-sync Phase 4）
- **E2EE**：整个 MoveOp 加密（不只是 title/url），服务端只见密文 + op_id + seq

**数据迁移**（现有快照 → CRDT 操作日志）：

1. 设备首次升级时，读取当前本地书签树，为每个节点生成 `Create` MoveOp（时间戳设为迁移时刻）
2. 推送到 Supabase 操作日志
3. 其他设备升级后，拉取操作日志重放，与本地快照做对账
4. 保留旧快照表 `bsync_bookmarks` 作为回滚兜底，一个版本后废弃

**子步骤**：

| 步骤 | 操作 | 影响面 | 回滚方式 |
|------|------|--------|----------|
| C1 | 移植 bookmark-crdt-sync 的 `crdt/` + `storage/` 到 `src/crdt/` + `src/storage/` | 新增代码，不影响现有 sync.js | 删除新目录 |
| C2 | 新增 Supabase 迁移：`bsync_op_log` 表 + push/pull RPC | 数据库（新增表，不删旧表） | 删除新表 |
| C3 | 实现 `src/sync-protocol/`：操作日志 push/pull（加密） | 新增代码 | 删除新目录 |
| C4 | 重构 `src/sync.js`：chrome.bookmarks 事件 → MoveOp → 本地 apply → push；pull → receiveOp → 反向应用 | **核心替换** | 保留旧 sync.js 为 `sync-legacy.js`，feature flag 切换 |
| C5 | 根节点识别改为 folderType | sync.js | 回退 title 匹配 |
| C6 | 加密升级：操作级 AES-GCM（替代字段级），PBKDF2 随机盐 | crypto.js + 数据格式 | feature flag 回退字段级 |
| C7 | background.js 加 chrome.alarms 周期同步 | background.js | 移除 alarms |
| C8 | 数据迁移脚本：旧快照 → 操作日志 | 一次性 | 保留旧表 |
| C9 | 灰度发布：新用户默认 CRDT，老用户 feature flag 逐步切换 | 发布策略 | flag 回退 |

**验收**：
- 双设备并发移动文件夹不丢子树、不产生循环
- 离线编辑后合并收敛
- 旧快照数据可迁移至操作日志
- Supabase 只见密文操作
- 1000 节点书签树同步 < 5s

### 阶段 D：测试与 CI 基建（中风险，1-2 周）

| 步骤 | 操作 | 影响面 |
|------|------|--------|
| D1 | 引入 vitest，覆盖 `crdt/` 核心（可复用 bookmark-crdt-sync 的 103 个测试） | 测试 |
| D2 | 覆盖 `crypto.js` 加解密往返、篡改检测 | 测试 |
| D3 | 覆盖 `sync-protocol/` push/pull 逻辑（mock Supabase） | 测试 |
| D4 | 引入 ESLint + Prettier | 代码质量 |
| D5 | CI 增加 `pnpm test` + `pnpm lint` 步骤（release 前） | CI |
| D6 | 渐进式引入 TypeScript（先 crdt/ + storage/，再 sync/） | 类型安全 |

**验收**：CI 流水线测试全绿；核心模块测试覆盖率 > 70%。

---

## 5. 风险清单

| # | 风险 | 等级 | 影响 | 缓解措施 |
|---|------|------|------|----------|
| 1 | **数据迁移失败导致用户书签丢失** | 严重 | 生产用户数据 | 保留旧快照表作为兜底；迁移前自动备份；灰度发布（先内部测试，再 10% 用户）；feature flag 可秒级回退 |
| 2 | **CRDT 与现有三态合并行为不一致** | 高 | 同步结果差异 | 双轨运行一段时间：CRDT 计算结果与旧引擎对比，差异告警；bookmark-crdt-sync 已有 103 单测 + 8 E2E 场景验证 |
| 3 | **AMO 审核因架构变更被拒** | 中 | 发布延迟 | 提前在 AMO 开发者文档确认操作日志存储合规；源码包提交时包含新代码 |
| 4 | **Supabase 操作日志表增长过快** | 中 | 存储成本/查询慢 | 复用 bookmark-crdt-sync Phase 4 的 GC（快照 + 截断）；定期清理稳定操作 |
| 5 | **Safari Xcode 壳构建产物移除后打包失败** | 低 | Safari 构建 | `scripts/post-build-safari.mjs` 已负责生成 assets，移除入库产物不影响构建；验证 Xcode build 脚本 |
| 6 | **submodule 未初始化导致新贡献者无法构建** | 低 | 开发体验 | README 补充 `git submodule update --init`；CI 已用 `actions/checkout@v4`（需确认 submodules: recursive） |
| 7 | **E2EE 从字段级升级为操作级后，旧数据无法解密** | 高 | 用户数据不可读 | 迁移时用旧密钥解密旧字段级数据，重新加密为操作级；保留旧解密代码一个版本 |
| 8 | **Creem 计费与 Supabase 配额耦合** | 中 | 计费功能 | 操作日志表需按用户配额限制（`bsync_snapshot_push` 已有 quota_exceeded 机制，复用） |
| 9 | **website/ 拆仓后 CI/部署断裂** | 低 | 官网发布 | 拆仓前确认 Vercel 项目配置；不拆则无此风险 |

---

## 6. 需要用户拍板的决策点

### 决策点 1：同步引擎是否升级为 Move-CRDT？

- **推荐：是，分阶段升级**
- 理由：现有三态合并的移动冲突用 LWW 近似（`sync.js:19` 自认），并发移动文件夹有丢子树/循环风险；`.workbuddy/guideline.md` 已规划此方向；`bookmark-crdt-sync` 已用 103 单测 + 8 真实 Chromium E2E 场景验证了核心算法
- 替代方案：维持快照引擎，仅修复移动冲突的特定 case（治标不治本）
- 影响：C 阶段 2-4 周工作量，需数据迁移

### 决策点 2：website/ 与 Xcode 壳是否拆独立仓库？

- **推荐：暂不拆，本仓库内用目录隔离**
- 理由：website/ 已有独立 package.json/lock，构建互不干扰；Xcode 壳与扩展共享构建产物（post-build-safari.mjs），拆仓会增加同步成本；monorepo 工具（pnpm workspace）可后续引入
- 替代方案：拆为 3 个仓库（extension / website / safari-shell），用 git submodule 或 npm 包共享代码
- 影响：不拆则无额外工作量；拆则需迁移 CI/部署配置

### 决策点 3：dist/、.uploads/、构建产物是否移出 git？

- **推荐：是，全部移出**
- 理由：CI 已自动构建 zip 并上传 GitHub Release，dist/ 入库是冗余且过期（v0.1.0 vs 当前 v1.1.0）；Xcode assets 由构建脚本生成；.uploads/ 是临时图片
- 替代方案：保留 dist/ 作为「历史发布备份」（但已过期，无价值）
- 影响：`git rm --cached` 不删除本地文件，仅停止跟踪；仓库减小 ~1.1MB

### 决策点 4：是否引入 TypeScript 与单元测试基建？

- **推荐：是，渐进式引入**
- 理由：同步引擎是分布式系统，类型安全和测试对正确性至关重要；bookmark-crdt-sync 已证明 TS + vitest 的有效性；现有 8 个 JS 文件可逐步迁移
- 替代方案：维持 JS + JSDoc 类型注释，仅加测试
- 影响：D 阶段 1-2 周；crdt/ 模块从 bookmark-crdt-sync 移植时已是 TS，零迁移成本

### 决策点 5：E2EE 是否从字段级升级为操作级（整 op 加密）？

- **推荐：是，随 C 阶段一起升级**
- 理由：字段级加密暴露了 sync_id/parent/type/order/updated_at 元数据，服务端可推断书签树结构；操作级加密只暴露 op_id 和 seq，元数据泄露最小化；bookmark-crdt-sync Phase 3 已验证此模式
- 替代方案：维持字段级（服务端可见树结构但不可见内容）
- 影响：需数据迁移（旧字段级密文 → 新操作级密文）；Supabase 表结构需调整

### 决策点 6：Supabase 后端是否需要独立的操作日志表，还是复用现有快照表？

- **推荐：新增 `bsync_op_log` 表，保留旧快照表一个版本**
- 理由：操作日志是 CRDT 的权威数据源，快照只是物化视图；分开存储便于增量同步和 GC；旧表保留用于回滚和迁移
- 替代方案：在现有 `bsync_bookmarks` 表上加 op 字段（混用，查询复杂）
- 影响：需新增 Supabase 迁移（在中央仓库 supabase-snaply-multi 中提交）

---

## 7. 与 bookmark-crdt-sync 的代码复用映射

`bookmark-crdt-sync`（本会话同期构建，103 单测 + 8 E2E 全绿）可直接复用的模块：

| 模块 | 文件 | 行数 | 复用方式 |
|------|------|------|----------|
| Move-CRDT 核心 | `src/moveCrdt.ts` | ~150 | 直接复制到 `src/crdt/` |
| Replica 状态机 | `src/replica.ts` | ~200 | 直接复制 |
| 时间戳 | `src/timestamp.ts` | ~30 | 直接复制 |
| 树查询 | `src/tree.ts` | ~50 | 直接复制 |
| Fractional Index | `src/fractionalIndex.ts` | ~100 | 直接复制 |
| IndexedDB 持久化 | `src/storage/` (5 文件) | ~400 | 直接复制 |
| AES-GCM 加密 | `src/crypto/` (5 文件) | ~390 | 参考实现，适配 Supabase 密钥管理 |
| GC 快照 | `src/sync/snapshot.ts` | ~112 | 参考实现，适配 Supabase 操作日志 |
| chrome.bookmarks 适配 | `src/extension/` (7 文件) | ~600 | 参考实现，替换 mockChrome 为真实 API |

**不可直接复用**：`src/sync/`（Merkle-DAG + WebSocket 中继）—— bookmark-sync 用 Supabase 做中心化操作日志，不需要 P2P DAG。但 Merkle-DAG 的 CID 去重思想可用于操作日志的幂等性。

---

## 8. 附录：关键文件审计详情

### 8.1 src/sync.js 同步引擎分析

- **协议**：`bsync_snapshot_pull`（拉远端快照）→ 三态合并 → `applyNodes`（写本地）→ `bsync_snapshot_push`（推合并结果 + 墓碑）→ 重新拉取作为 baseline
- **冲突解决**：LWW（`updated_at` 较新者胜）；删除优先（墓碑粘性）；移动冲突 LWW 近似
- **根节点识别**：title 匹配（`"Bookmarks Bar"` / `"Bookmarks Toolbar"`），非 folderType
- **存储**：baseline/maps/墓碑存在 `chrome.storage.local`（非 IndexedDB）
- **空间**：支持多空间（`bsync_spaces` 表），默认空间回退老键
- **首同步**：设备×空间级确认（合并/远程覆盖/暂不同步）

### 8.2 src/crypto.js 加密层分析

- **算法**：AES-256-GCM，字段级（仅 title/url）
- **格式**：`v1.<ivBase64Url>.<ciphertextBase64Url>`
- **密钥**：随机 32 字节，存 `chrome.storage.local`；可选 PBKDF2 口令派生（固定盐，210k 轮）
- **默认**：明文模式（`getEncryptMode()` 默认 `"plain"`）
- **局限**：sync_id/parent/type/order/updated_at 明文暴露；无 AAD；无密钥轮换

### 8.3 CI 分析

- **release-please**：Conventional Commits 自动版本号 + CHANGELOG
- **构建**：`npx vite build` + `node scripts/build-firefox.mjs`（不用 `pnpm build`，避免触发 Xcode）
- **产物**：两个 zip 上传 GitHub Release
- **缺失**：无 test/lint 步骤；无 submodule 初始化确认

---

*本文档基于 2026-09-14 对仓库 main 分支（commit e1c892e）的实际文件内容审计。所有判断均标注来源；不确定处已在文中说明。*
