#!/usr/bin/env node
/**
 * store-gate.mjs — 商店提交前的版本闸门。
 *
 * 背景：商店提交是发布流程里唯一会「真过量上线给用户」的动作，且同一版本重复提交
 * 会被三家商店以「版本号未递增」拒绝。自动链路（release.yml 末尾自动 dispatch
 * publish-stores.yml）必须有一道闸门，否则一次误触发就让整轮 run 变红，还得人工分辨。
 *
 * 判据（复用 fetch-store-versions.mjs 的采集逻辑，不另写一份）：
 *   - 目标版本 > 在架版本            → 放行（submit）
 *   - 目标版本 <= 在架版本           → 跳过（skip，该家已等于或高于目标）
 *   - 目标版本 == pending（审核中）   → 跳过（skip，已提交过，正在审）
 *   - 采集失败                        → 保守起见放行（submit），让商店自己拒绝；
 *                                       宁可红在商店侧，也不因探测失败而静默漏发。
 *
 * 输出：GITHUB_OUTPUT 写 chrome=edge=firefox=<submit|skip>，以及人类可读的 reason；
 *       同时写 GITHUB_STEP_SUMMARY 表格。退出码恒 0 —— 闸门的职责是「决定要不要提交」，
 *       不是「判断对错」；真正该红的是商店提交本身（publish-stores.yml 已负责）。
 *
 * 用法：
 *   TARGET_VERSION=2.15.2 node scripts/store-gate.mjs
 *
 * 环境变量：
 *   TARGET_VERSION  必填，要提交的版本号（不带 v 前缀）
 *   Chrome 凭证（与 fetch-store-versions.mjs 同）：CHROME_PUBLISHER_ID /
 *   CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL / CHROME_SERVICE_ACCOUNT_PRIVATE_KEY
 */

import { appendFileSync } from 'node:fs';
import { fetchAllStoreVersions } from './fetch-store-versions.mjs';

const VERSION_RE = /^\d+(\.\d+)*$/;

/** 逐段数值比较，避免 '2.9.0' > '2.10.0' 的字符串序错误。 */
export function compareVersions(a, b) {
  if (a === b) return 0;
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/** 单家判定：返回 { action: 'submit'|'skip', reason }。 */
export function decideStore(target, info) {
  if (!info || info.error) {
    // 采集失败：放行，让商店侧给权威答案（拒绝会红，能发现；跳过会静默漏发）。
    return { action: 'submit', reason: `采集失败（${info?.error ?? '无数据'}），交由商店侧判定` };
  }
  const live = info.version;
  if (!live || !VERSION_RE.test(live)) {
    return { action: 'submit', reason: `在架版本异常（${JSON.stringify(live)}），交由商店侧判定` };
  }
  if (info.pending && compareVersions(target, info.pending) === 0) {
    return {
      action: 'skip',
      reason: `${target} 正在审核中（pending=${info.pending}${info.pendingState ? ` · ${info.pendingState}` : ''}），重复提交会被拒`,
    };
  }
  const cmp = compareVersions(target, live);
  if (cmp > 0) {
    return { action: 'submit', reason: `在架 ${live} < 目标 ${target}` };
  }
  if (cmp === 0) {
    return { action: 'skip', reason: `在架已等于目标 ${target}` };
  }
  return { action: 'skip', reason: `在架 ${live} 已高于目标 ${target}` };
}

function writeOutput(key, value) {
  const path = process.env.GITHUB_OUTPUT;
  if (path) appendFileSync(path, `${key}=${value}\n`);
}

async function main() {
  const target = (process.env.TARGET_VERSION || '').trim().replace(/^v/, '');
  if (!target || !VERSION_RE.test(target)) {
    console.error(
      `::error::TARGET_VERSION 缺失或非法：${JSON.stringify(process.env.TARGET_VERSION)}`,
    );
    // 闸门自身配置错误时不能擅自放行，也不能静默跳过 —— 让 job 红，人来修。
    writeOutput('chrome', 'error');
    writeOutput('edge', 'error');
    writeOutput('firefox', 'error');
    process.exit(1);
  }

  console.log(`目标版本：${target}`);
  const { results, failures } = await fetchAllStoreVersions();
  for (const [name, info] of Object.entries(results)) {
    const { action, reason } = decideStore(target, info);
    writeOutput(name, action);
    writeOutput(`${name}_reason`, reason);
    const mark = action === 'submit' ? '→ 提交' : action === 'skip' ? '→ 跳过' : '→ 错误';
    console.log(`${mark}  ${name}: ${reason}`);
  }

  const rows = ['## 商店提交闸门', '', '| 商店 | 在架 | 判定 | 理由 |', '|---|---|---|---|'];
  for (const [name, info] of Object.entries(results)) {
    const { action, reason } = decideStore(target, info);
    rows.push(`| ${name} | ${info?.version ?? '—'} | ${action} | ${reason} |`);
  }
  rows.push('', `目标版本 **${target}**；采集失败：${failures.join(', ') || '无'}`);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, `${rows.join('\n')}\n`);
    } catch {
      /* summary 写不进去不影响闸门判定 */
    }
  }
  // 三家全部 skip 时让 job 早停：不必去下载 zip、跑 CLI。
  const allSkip = Object.values(results).every(
    (info) => decideStore(target, info).action === 'skip',
  );
  writeOutput('all_skip', allSkip ? 'true' : 'false');
  if (allSkip) {
    console.log('\n三家在架版本均已达到或高于目标，无需提交。');
  }
  process.exit(0);
}

// 仅在「直接作为 CLI 执行」时跑 main；被 import（如 tests/store-gate.test.ts）
// 时不自动执行，否则缺 TARGET_VERSION 会 process.exit 掉测试进程。
const invokedDirectly =
  typeof process.argv[1] === 'string' && process.argv[1].endsWith('store-gate.mjs');
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`::error::${e?.stack || e}`);
    process.exit(1);
  });
}
