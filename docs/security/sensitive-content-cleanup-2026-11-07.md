# 敏感内容清理清单（开源前核查）

- 日期：2026-11-07 · 按 2026-11-05 开源清单 1.7 编制
- **性质：只列不动手。** 本清单不执行任何删除/改写；处置动作属第二阶段，须 catnuko 逐项点头。
- 密钥扫描结论见同目录 [secret-scan-2026-11-07.md](secret-scan-2026-11-07.md)：**git 历史中 0 条真密钥**，凭证类文件均未入库。

## A. 已跟踪、进公开叙事前建议移除或改写的（git 里有历史，需在转 public 前决定）

| #   | 对象                                                                                                                   | 现状                                                                     | 处置意见                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| A1  | `AGENTS.md`（根目录）                                                                                                  | 开发注意事项：构建命令、CI 发版关键点、Safari 硬约束、协作约定、运营细节 | 内部工作流文件，不进公开叙事。README 已改写不再引用。建议：转 public 前从仓库移除（有用内容并入 CONTRIBUTING.md / docs）     |
| A2  | `memory/refactor-v2-move-crdt.md`                                                                                      | agent 工作记忆（重构笔记）                                               | 建议移除                                                                                                                     |
| A3  | `.workbuddy/design/`（DESIGN.md、REVIEW-critique*.md、UI prototype html，4 个文件）+ `.workbuddy/memory/2026-09-15.md` | 内部设计评审与工作记忆，共 5 个跟踪文件                                  | `.workbuddy/` 中已跟踪部分建议移除；有用设计文档（如 UI 原型）可先迁到 `docs/design/` 再删原位                               |
| A4  | `docs/NEXT-STEPS.md`                                                                                                   | 内部推进计划；含 Supabase publishable key（设计上公开，非事故）          | 内部叙事，建议移除                                                                                                           |
| A5  | `docs/refactor-plan.md`、`docs/manual-test-plan.md`、`docs/ci-test-job.patch`、`docs/design-shadcn-rewrite.md`         | 内部重构方案/手工测试计划/CI 补丁                                        | 建议逐篇过目：有开源价值的（如 CRDT 升级方案）改写后留 `docs/`，其余移除                                                     |
| A6  | `docs/safari-sync-research.md`                                                                                         | Safari 立项尽调，引用 AGENTS.md                                          | 同 A5；若 Safari 有开源计划可改写保留                                                                                        |
| A7  | `docs/admin/PROPOSAL.md`、`docs/admin/0020_admin_rpc.sql`                                                              | 后台管理面方案与 SQL                                                     | 含运营面细节，建议移除或脱敏（管理 RPC 本身已在 migrations，文档可简化保留）                                                 |
| A8  | `scripts/e2e/scenarios/creem-checkout.mjs`、`creem-webhook.mjs`                                                        | **硬编码真实 Creem product ID**（`prod_…` 两个，Plus/Pro）               | 属真实商业 ID（公开后可被拉起购买页）。建议改成 `process.env.CREEM_PRODUCT_…` 占位。非密钥，无资损风险，但公开叙事上建议清掉 |

## B. 未跟踪、已 gitignore、确认从未入库的（继续保持 ignore，无需动作）

| #   | 对象                                            | 内容                                                                        | 核查结论                                                                             |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| B1  | `.dev-creds.json`                               | 测试账号邮箱/密码/E2EE 口令/aiKey                                           | 已 ignore，从未进 git 历史（`git check-ignore` + 2026-11-05 `git log --all` 双确认） |
| B2  | `.env.submit`                                   | 商店提交通                                                                  | 同上                                                                                 |
| B3  | `.workbuddy/e2e.env`                            | E2E 真实测试账号                                                            | 同上                                                                                 |
| B4  | `.claude/`（含 worktrees 副本）、`.qoder/`      | agent 本地工作区                                                            | 同上                                                                                 |
| B5  | `scripts/e2e/.reports/`                         | e2e 报告 JSON，含 Creem checkout URL（带一次性 `ch_` 会话 ID）与 product ID | 已 ignore，从未入库                                                                  |
| B6  | `website/.next/**`、`.workbuddy/xb-profiles/**` | 构建/浏览器缓存                                                             | 未跟踪                                                                               |

## C. 核对过、确认无需处理的

| #   | 对象                                                       | 结论                                                                                                                                                                              |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `.github/workflows/`（release.yml、publish-stores.yml 等） | 无硬编码 token/账号/凭证路径；全部走 `secrets.*`（GITHUB_TOKEN、CHROME_SERVICE_ACCOUNT__、EDGE__、FIREFOX_JWT_*、SUPABASE_SERVICE_ROLE_KEY），凭证闸门在 job 内注入。**无需处理** |
| C2  | `bookmark-sync/`（Xcode 工程）                             | `PRODUCT_BUNDLE_IDENTIFIER = catnuko.bookmark-sync(.Extension)`（公开无妨）；`CODE_SIGN_STYLE = Automatic`；**无 DevelopmentTeam / 证书路径硬编码**。无需处理                     |
| C3  | `supabase/migrations/`、`supabase/functions/`              | Creem 的 product/price 通过环境变量（`CREEM_PRODUCT_PLUS/PRO`）注入，迁移与函数内无真实 ID/密钥。无需处理                                                                         |
| C4  | `src/lib/supabase.ts`、`website/src/lib/supabase.js`       | 硬编码 Supabase URL + publishable key——**设计上公开**（客户端密钥 + RLS 边界），保留并已在 SELF-HOSTING/PRIVACY 文档中写明                                                        |
| C5  | `src/crdt/crypto/key.ts`、`src/sync/keyManager.ts`         | 密钥算法代码，非密钥（两把扫描器均未命中）                                                                                                                                        |
| C6  | `scripts/e2e/e2e.env.example`                              | 丢弃型测试账号示例口令，文件已注明用途。保留                                                                                                                                      |

## 与第二阶段的衔接

- 密钥轮换：**无必须项**（历史 0 真密钥）。
- 历史改写：动机只剩 A 组（内部文档）——若 catnuko 选择不改历史，A 组文件的「移除」只在转 public 前提交一次删除即可，历史仍可考古，需他知情后二选一。
- 转 public 前 A 组建议全部落定；B 组保持现状即可。
