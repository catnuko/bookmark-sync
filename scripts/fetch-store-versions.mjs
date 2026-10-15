#!/usr/bin/env node
/**
 * 采集三家浏览器商店的**在架版本**，写入 Supabase Storage public bucket `downloads`
 * 的 `stores.json`（官网运行时读取，与 latest.json 语义互不派生）。
 *
 * 为什么需要它：我们「已发布」的版本（latest.json）与商店「在架」的版本经常不一致
 * ——商店审核有延迟。官网必须把两个数字分开展示，否则用户点进商店会看到与官网
 * 不一致的版本号。
 *
 * 三家来源（彼此独立，单个失败不影响其他）：
 *   - Chrome Web Store API v2：SA JWT → access token → items/<id>:fetchStatus
 *       · 在架   = publishedItemRevisionStatus.distributionChannels[0].crxVersion
 *         （+ state，如 PUBLISHED）
 *       · 提交中 = submittedItemRevisionStatus.distributionChannels[0].crxVersion
 *         （+ state，如 PENDING_REVIEW / STAGED —— 用来区分「还在审」还是「过审待人工放行」）
 *   - Edge：官方 Partner Center API **没有**读取已发布版本的端点（文档穷举），
 *     改用店面端点 getproductdetailsbycrxid/<crxId>（非官方，实测 200）。
 *   - Firefox AMO：公开 API v5，无需凭证。
 *
 * 用法：
 *   node scripts/fetch-store-versions.mjs                # 采集 + 上传
 *   node scripts/fetch-store-versions.mjs --dry-run      # 只采集并打印，不上传
 *   node scripts/fetch-store-versions.mjs --out <path>   # 另存本地一份便于检查
 *
 * 导出：`fetchAllStoreVersions()` 供 scripts/store-gate.mjs 复用（商店提交前的版本闸门），
 *       避免两处各写一份采集逻辑而漂移。CLI 直接跑时走 main()，作为模块 import 时不自动执行。
 *
 * 退出码：三家全成功 = 0；**任一失败 = 1**（成功项照常写入，失败项保留线上旧值），
 * 让定时任务红起来，不至于把商店采集坏掉这件事静默掉。
 *
 * 本地直连被 RST 时走代理：Node ≥ 24 用 `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=...`
 * （Node 原生 fetch 不读代理环境变量，需显式开启）。
 *
 * 凭证（Chrome 需要；Edge/Firefox 不需要）走环境变量，本地也可放 gitignored 的
 * `.env.submit`（与 publish-browser-extension 同一份约定）。
 */

import { createSign } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const SUPABASE_OBJECT_BASE = 'https://cwtqnsbpcetvqopdkcou.supabase.co/storage/v1/object';
const BUCKET = 'downloads';

// 公开常量（与 publish-stores.yml 里写死的一致）
const CHROME_EXTENSION_ID = 'emmjhpmhfepapemiflddnbmikicklfml';
const EDGE_CRX_ID = 'ilhfggggmdgfnliiimnkhdbaijjombah'; // 店面 crxId，不是 EDGE_PRODUCT_ID
const FIREFOX_ADDON_ID = 'bookmark-sync-app';

const TIMEOUT_MS = 15000;
const VERSION_RE = /^\d+(\.\d+)*$/;

// ---------------------------------------------------------------- 小工具

/** 读 .env.submit（存在才读；不覆盖已有环境变量）——本地跑免去每次 export。 */
function loadEnvFile(path = '.env.submit') {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function assertVersion(v, label) {
  if (typeof v !== 'string' || !VERSION_RE.test(v)) {
    throw new Error(`${label} 返回了非预期版本号：${JSON.stringify(v)}`);
  }
  return v;
}

/** GET JSON，带超时；非 2xx 抛出可读错误。 */
async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`响应不是 JSON：${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------- Chrome

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** 服务账号自签 RS256 JWT（scope=chromewebstore）。 */
function chromeServiceJwt(clientEmail, privateKey) {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    }),
  );
  const data = `${header}.${claim}`;
  const sig = createSign('RSA-SHA256').update(data).sign(privateKey);
  return `${data}.${sig.toString('base64url')}`;
}

async function chromeAccessToken(clientEmail, privateKey) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: chromeServiceJwt(clientEmail, privateKey),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`换 access token 失败：HTTP ${res.status} — ${body.slice(0, 300)}`);
  const token = JSON.parse(body)?.access_token;
  if (!token) throw new Error('换 access token 失败：响应缺少 access_token');
  return token;
}

async function fetchChrome() {
  const publisherId = process.env.CHROME_PUBLISHER_ID;
  const clientEmail = process.env.CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const privateKey = process.env.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!publisherId || !clientEmail || !privateKey) {
    throw new Error('缺少 CHROME_PUBLISHER_ID / CHROME_SERVICE_ACCOUNT_* 凭证');
  }
  const token = await chromeAccessToken(clientEmail, privateKey);
  // ★ 是 GET，不是 POST；`:fetchStatus` 必须保持未编码。
  const url =
    `https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisherId)}` +
    `/items/${encodeURIComponent(CHROME_EXTENSION_ID)}:fetchStatus`;
  const data = await getJson(url, { headers: { Authorization: `Bearer ${token}` } });

  const crxVersion = (rev) => rev?.distributionChannels?.[0]?.crxVersion ?? null;
  const published = data.publishedItemRevisionStatus;
  const submitted = data.submittedItemRevisionStatus;

  const out = {};
  if (published) {
    out.version = assertVersion(crxVersion(published), 'Chrome(published)');
    if (published.state) out.state = published.state;
  }
  const pendingVer = crxVersion(submitted);
  if (pendingVer && VERSION_RE.test(pendingVer) && pendingVer !== out.version) {
    out.pending = pendingVer;
    // 提交侧状态（与在架侧 state 同名不同义，故叫 pendingState）：
    //   PENDING_REVIEW = 还在审；STAGED = 过审但未自动上架、需去 CWS 后台点「发布」。
    // 这两者对外都表现为「已提交、未上架」，但下一步动作不同（等 vs 人工放行）。
    if (submitted.state) out.pendingState = submitted.state;
  }
  if (!out.version && !out.pending) throw new Error('fetchStatus 未返回任何版本号');
  return out;
}

// ---------------------------------------------------------------- Edge

async function fetchEdge() {
  const url = `https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${EDGE_CRX_ID}`;
  const data = await getJson(url);
  return { version: assertVersion(data.version, 'Edge') };
}

// ---------------------------------------------------------------- Firefox

async function fetchFirefox() {
  const url = `https://addons.mozilla.org/api/v5/addons/addon/${FIREFOX_ADDON_ID}/`;
  const data = await getJson(url);
  const v = data?.current_version?.version;
  const status = data?.current_version?.status;
  if (status && status !== 'public') {
    throw new Error(`AMO current_version.status=${status}（不是已上架版本）`);
  }
  return { version: assertVersion(v, 'Firefox') };
}

// ---------------------------------------------------------------- Supabase

async function getPrevStores() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  const res = await fetch(`${SUPABASE_OBJECT_BASE}/${BUCKET}/stores.json`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null; // 首次运行
  if (!res.ok) {
    console.warn(`读取线上 stores.json 失败（HTTP ${res.status}），本次按「无旧值」处理`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    console.warn('线上 stores.json 不是合法 JSON，本次按「无旧值」处理');
    return null;
  }
}

async function putStores(json) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('缺少 SUPABASE_SERVICE_ROLE_KEY，无法上传');
  const res = await fetch(`${SUPABASE_OBJECT_BASE}/${BUCKET}/stores.json`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(json),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `上传 stores.json 失败：HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`,
    );
  }
}

// ---------------------------------------------------------------- 主流程

/** 采集三家在架版本。复用点：scripts/store-gate.mjs 的版本闸门。 */
export async function fetchAllStoreVersions() {
  const stores = [
    ['chrome', fetchChrome],
    ['edge', fetchEdge],
    ['firefox', fetchFirefox],
  ];
  const results = {};
  const failures = [];
  for (const [name, fn] of stores) {
    try {
      results[name] = await fn();
    } catch (e) {
      failures.push(name);
      results[name] = { error: e.message };
    }
  }
  return { results, failures };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const outIdx = argv.indexOf('--out');
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;

  loadEnvFile();

  const { results, failures } = await fetchAllStoreVersions();
  for (const [name, r] of Object.entries(results)) {
    if (failures.includes(name)) console.error(`✗ ${name}: ${r.error}`);
    else console.log(`✓ ${name}: ${JSON.stringify(r)}`);
  }

  const succeeded = Object.keys(results).filter((k) => !failures.includes(k));
  if (succeeded.length === 0) {
    console.error('\n三家全部采集失败，不覆盖线上 stores.json。');
    return 1;
  }

  // 先取旧值，只覆盖本次成功的项 —— 单家失败不该把它的版本号抹掉。
  const prev = dryRun ? null : await getPrevStores();
  const { updatedAt: _ignored, ...prevRest } = prev && typeof prev === 'object' ? prev : {};
  const ok = Object.fromEntries(succeeded.map((k) => [k, results[k]]));
  const merged = { updatedAt: new Date().toISOString(), ...prevRest, ...ok };

  const text = `${JSON.stringify(merged, null, 2)}\n`;
  if (outPath) {
    writeFileSync(outPath, text);
    console.log(`\n已写入本地 ${outPath}`);
  }
  console.log(`\nstores.json:\n${text}`);

  if (!dryRun) await putStores(merged);

  await writeSummary(merged, failures, dryRun);

  if (failures.length) {
    console.error(`\n::error::商店版本采集失败：${failures.join(', ')}`);
    return 1;
  }
  return 0;
}

async function writeSummary(merged, failures, dryRun) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const row = (name) => {
    const r = merged[name];
    if (!r?.version) return '—';
    const pending = r.pending
      ? `（提交中 ${r.pending}${r.pendingState ? ` · ${r.pendingState}` : ''}）`
      : '';
    return `${r.version}${pending}`;
  };
  const lines = [
    '## 商店在架版本',
    '',
    '| 商店 | 在架版本 |',
    '|---|---|',
    `| Chrome Web Store | ${row('chrome')} |`,
    `| Edge Add-ons | ${row('edge')} |`,
    `| Firefox AMO | ${row('firefox')} |`,
    '',
    dryRun ? '> --dry-run：未上传。' : '> 已写入 downloads/stores.json。',
  ];
  if (failures.length) lines.push(`> ⚠️ 采集失败：${failures.join(', ')}（保留线上旧值）`);
  try {
    appendFileSync(path, `${lines.join('\n')}\n`);
  } catch {
    /* summary 写不进去不影响主流程 */
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`::error::${e?.stack || e}`);
    process.exit(1);
  },
);
