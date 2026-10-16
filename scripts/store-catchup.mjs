#!/usr/bin/env node
/**
 * store-catchup.mjs — 商店补发：某家在发版时没能提交上，事后自动补一刀。
 *
 * 为什么需要：Chrome Web Store 有条硬限制 —— **只要有 item 在审核中，就不许
 * edit or publish**（400 FAILED_PRECONDITION / NOT_UPDATEABLE），且与版本号无关。
 * 于是「发版时 Chrome 正在审上一版」→ 版本闸门跳过本次提交 → 等 Chrome 审完，
 * 已经没有任何东西会再把最新版推上去，Chrome 就永久停在旧版本。
 * 2026-10-15 实测：v2.16.0 提交后进审核，v2.16.1 / v2.16.2 的提交全被拒，
 * Chrome 停在 2.16.0，而 Firefox 已到 2.16.2（AMO 允许审核中继续提交）。
 *
 * 为什么只补 Chrome：补发的前提是「能确认这家没在审核中」，否则重复提交只会被拒。
 *   - Chrome 的 fetchStatus 明确返回 submittedItemRevisionStatus（含 PENDING_REVIEW /
 *     STAGED），有没有在审是已知量 → 可以安全补。
 *   - Edge 走店面端点，只返回**已发布**版本，看不到审核中的版本 → 无法判断；
 *     重复提交可能以「版本号未递增」被拒，反而制造红色 run。Edge 落后是审核延迟，
 *     再提交也不会更快，等它自己过审即可。
 *   - Firefox 公开 API 同样只给 current_version；且 AMO 允许审核中提交，发版时的
 *     dispatch 已经覆盖了它，不存在「被卡住」的场景。
 *   Edge / Firefox 真落后了（审核被拒等异常）→ 手动 Actions → Publish to stores。
 *
 * 为什么不会自己打转：补发成功后 Chrome 立刻有 pending，下一轮采集时闸门判 skip，
 * 本脚本随即不 dispatch。所以 6 小时一轮的定时里最多 dispatch 一次，不会刷 run。
 *
 * 由 .github/workflows/store-versions.yml 在采集之后调用（if: always()，采集成败
 * 不影响补发判定 —— 本脚本自己重新采集一次，只看 Chrome 的数据）。
 *
 * 环境变量：
 *   LATEST_TAG           必填，最新 Release 的 tag（如 v2.16.2）
 *   GH_REPO              必填（owner/name），dispatch 用
 *   GH_TOKEN             dispatch 用（GITHUB_TOKEN 即可；workflow_dispatch 不受
 *                        「GITHUB_TOKEN 触发的事件被递归抑制」那条规则约束，
 *                        release.yml 的 dispatch 同款用法，实测可用）
 *   Chrome 凭证：CHROME_PUBLISHER_ID / CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL /
 *                CHROME_SERVICE_ACCOUNT_PRIVATE_KEY（与 fetch-store-versions.mjs 同）
 */

import { execFileSync } from 'node:child_process';
import { fetchAllStoreVersions } from './fetch-store-versions.mjs';
import { decideStore } from './store-gate.mjs';

/**
 * 决定要不要 dispatch 一次商店提交。纯函数，便于测试（tests/store-catchup.test.ts）。
 *
 * @param {string} latest 最新 Release 的版本号（不带 v 前缀）
 * @param {Record<string, {version?: string, pending?: string, error?: string}>} results
 *         fetchAllStoreVersions() 返回的 results
 * @returns {{dispatch: boolean, reason: string}}
 */
export function planCatchup(latest, results) {
  const chrome = results?.chrome;
  // 采集失败 → 不补：宁可等下一轮定时，也不要凭一条错误信息做不可逆的提交。
  if (!chrome || chrome.error) {
    return {
      dispatch: false,
      reason: `Chrome 采集失败（${chrome?.error ?? '无数据'}），等下一轮`,
    };
  }
  if (!chrome.version) {
    return { dispatch: false, reason: 'Chrome 未返回在架版本，等下一轮' };
  }
  const { action, reason } = decideStore(latest, chrome);
  if (action !== 'submit') {
    return { dispatch: false, reason: `Chrome 无需补发：${reason}` };
  }
  return { dispatch: true, reason: `Chrome 需要补发：${reason}` };
}

async function main() {
  const tag = (process.env.LATEST_TAG || '').trim();
  if (!tag) {
    console.error('::error::LATEST_TAG 未提供（应为最新 Release 的 tag，如 v2.16.2）');
    process.exit(1);
  }
  const latest = tag.replace(/^v/, '');

  const { results } = await fetchAllStoreVersions();
  console.log(`最新 Release：${tag}`);
  console.log(`Chrome 在架：${results.chrome?.version ?? '—'}`);
  const { dispatch, reason } = planCatchup(latest, results);
  console.log(reason);

  if (!dispatch) {
    console.log('本次不 dispatch 商店提交。');
    return;
  }

  const repo = process.env.GH_REPO;
  if (!repo) {
    console.error('::error::GH_REPO 未提供，无法 dispatch publish-stores.yml');
    process.exit(1);
  }
  // 显式传 tag：与 resolve 步骤「取最新 Release」等价，但少一次竞态。
  console.log(`dispatch publish-stores.yml（ref=main, tag=${tag}）…`);
  execFileSync('gh', ['workflow', 'run', 'publish-stores.yml', '--ref', 'main', '-f', `tag=${tag}`], {
    stdio: 'inherit',
  });
  console.log('已 dispatch。提交结果看 Publish to stores 工作流。');
}

// 仅在直接作为 CLI 执行时跑 main；被 import（如 tests/store-catchup.test.ts）时
// 不自动执行，否则缺 LATEST_TAG / 凭证会把测试进程 exit 掉（同 store-gate.mjs 的约定）。
const invokedDirectly =
  typeof process.argv[1] === 'string' && process.argv[1].endsWith('store-catchup.mjs');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`::error::${e?.stack || e}`);
    process.exit(1);
  });
}
