# 全历史密钥扫描报告（bookmark-sync）

- 扫描日期：2026-11-07
- 仓库：`github.com/catnuko/bookmark-sync`（private，dev 分支，381 个提交被扫描）
- 工具：
  - gitleaks（v2024.x，`gitleaks detect --log-opts="--all"` 全历史 + `--no-git` 工作区）
  - trufflehog（v3.99.8，`trufflehog git file://. --json` 全历史，含验证）
- 本报告不含任何密钥原文；原始扫描结果只存在于本机 `/tmp`，未入仓库。

## 总结论

**真密钥待轮换：0 条。** trufflehog 全历史验证（verified secrets）为 0；gitleaks 全历史 8 条命中经逐条核实，全部为 Supabase **anon / publishable key**（设计上就是客户端公开密钥）或占位符。全历史中不存在 service_role 密钥值、Creem API key、webhook secret 或任何第三方 token。

前置结论（2026-11-05 已核）：`.dev-creds.json`、`.env.submit` 从未进入 git 历史。

## 全历史命中明细（gitleaks 8 条）

| 文件 | 提交 | 类别 | 判定与处置 |
| --- | --- | --- | --- |
| `src/lib/supabase.js`（现为 `src/lib/supabase.ts`） | `4bcfdd72`、`7f95dc85` | Supabase URL + anon/publishable key（`sb_publishable_…`） | **设计上公开**。客户端密钥，安全边界靠 RLS。保留，无需轮换 |
| `src/preview.js`（现为 `src/preview.ts`） | `45e271c4`、`7f95dc85` | 同上（本地预览页用同一 anon key） | **设计上公开**。保留 |
| `website/src/lib/supabase.js` | `7f95dc85`、`8d4bdf46` | 官网用同一 Supabase URL + anon/publishable key | **设计上公开**。保留 |
| `macos-app/Tests/.../SupabaseAuthClientTests.swift` | `e08af890` | 测试桩 URL `https://abcdefghijklm.supabase.co` | **误报**（占位符，非真实项目） |
| `macos-app/Tests/.../SupabaseRpcClientTests.swift` | `2175f432` | 同上 | **误报** |

## trufflehog 全历史命中（11 条候选，0 条验证通过）

11 条候选全部为**同一个** `sbp_` 开头的 Supabase publishable key（44 字符），出现在已删除的一次性脚本/文档中：

- `scripts/e2e-sync.test.mjs`、`scripts/e2e-repro.mjs`、`scripts/e2e-final.mjs`、`scripts/e2e-dual.mjs`、`scripts/e2e-afterid.mjs`、`docs/NEXT-STEPS.md`（提交 `7f95dc85`、`04bf96ab`、`f9318b20`）

判定：**设计上公开**（与当前 `src/lib/supabase.ts` 内置的是同一把客户端 publishable key）。这些脚本已在 `12941af` 清理，但历史仍在。无需轮换。

另外核实：全历史中出现的 `service_role` 字样均为 Postgres 角色名（grant 语句、SQL 注释），非密钥值。

## 工作区命中（gitleaks --no-git 31 条，全部未跟踪 / gitignore 内）

| 路径 | 内容 | 判定与处置 |
| --- | --- | --- |
| `.dev-creds.json` | 测试账号邮箱/密码/口令/aiKey 键名 | **本地开发凭证**，已 gitignore，从未入库。继续留在 ignore 名单 |
| `.env.submit` | 商店提交通 | 同上，从未入库 |
| `.workbuddy/e2e.env` | E2E 真实测试账号 | 同上 |
| `.claude/worktrees/*/` | 上述凭证的本地工作树副本 | 同上 |
| `website/.next/**` 缓存、`.workbuddy/xb-profiles/firefox/cache2/**` | 构建缓存/浏览器缓存里的 anon key 残留 | 未跟踪，构建产物不入库 |
| `src/lib/supabase.ts`、`src/preview.ts`、`website/src/lib/supabase.js` | 当前跟踪文件中的 anon/publishable key | **设计上公开**（与全历史命中相同） |

## 清单 1.1 指定的三个误报类确认

- `src/crdt/crypto/key.ts`、`src/sync/keyManager.ts`：密钥派生/管理**算法代码**，本轮两把扫描器均未命中，确认为非密钥。
- `scripts/e2e/e2e.env.example`：含 `E2E_PASSPHRASE=bsync-e2e-passphrase-2026` 默认值——**设计上公开**（丢弃型测试账号的示例口令，仅用于测试库）。建议保持现状，文件内已写明这是专用测试账号、勿用真实口令。

## 对第二阶段的影响

- **轮换密钥：无必须项。** 若求稳，可在转公开后顺手在 Supabase Dashboard 轮换 publishable key（非必需，RLS 是真正的边界）。
- **历史改写（git filter-repo）的必要性降低**：历史里没有需要抹掉的密钥；若要改历史，动机只剩「移除内部文档」（AGENTS.md、.workbuddy/、docs 内部文档等，见敏感内容清理清单）——这仍是可选项，由 catnuko 决定。
