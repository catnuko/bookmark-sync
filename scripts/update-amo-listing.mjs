#!/usr/bin/env node
/**
 * 更新 Firefox AMO 商店页（listing）：简介（summary / description）与截图（previews）。
 *
 * ★ 三家商店里只有 AMO 提供元数据 API，因此本脚本只覆盖 AMO：
 *   - Firefox AMO：API v5 `PATCH /addons/addon/{id}/` + `/previews/` ✅ 本脚本
 *   - Edge：Add-ons Update REST API 明确「没有元数据端点」（官方文档原文
 *     "There aren't REST API endpoints for: updating a product's metadata"），
 *     API 只能传包 + 发布；改简介/截图必须进 Partner Center 网页。
 *   - Chrome：CWS API v2 只有传包/发布/状态/灰度，listing 文案与截图无端点；
 *     manifest 的 `description`（短描述）随包更新，详细简介和截图只能进 Dashboard。
 *
 * 内容源（单一真相）：extension-infomation/store-listing.json —— 三家商店共用一份文案，
 * 改文案只改这个文件，脚本每次现读，不维护第二份副本：
 *   - `locales.<locale>.summary` → AMO Summary
 *   - `locales.<locale>.description` → AMO Detailed Description
 *   - `locales.<locale>.shortDescription` → Chrome / Edge 的 manifest description（≤132 字符）
 * 截图：extension-infomation/store-assets/<lang>/1280x800/*.png|jpg，默认取 en。
 *
 * ★ 2026-10-25 起不再读 README：README 的 §2/§3.1/§3.2/§7 仍是人读版说明，
 *   但不再是本脚本的输入 —— 两处并存会漂移（Chrome 线上曾被手改，README 从未记录）。
 *
 * 用法：
 *   node scripts/update-amo-listing.mjs                    # 比对并更新文案（有差异才 PATCH）
 *   node scripts/update-amo-listing.mjs --dry-run          # 只比对打印，不写
 *   node scripts/update-amo-listing.mjs --screenshots      # 文案 + 替换截图（先删后传）
 *   node scripts/update-amo-listing.mjs --screenshots-only # 只替换截图
 *   node scripts/update-amo-listing.mjs --locales en-US    # 只推指定 locale（默认 en-US + zh-CN）
 *   node scripts/update-amo-listing.mjs --screenshots-dir extension-infomation/store-assets/zh/1280x800
 *
 * 凭证（仅写入时需要；--dry-run / 只读比对不需要）：
 *   FIREFOX_JWT_ISSUER / FIREFOX_JWT_SECRET（AMO → 开发者中心 → 管理 API 密钥），
 *   走环境变量或 gitignored 的 `.env.submit`。
 *
 * 本地直连被 RST 时：Node ≥ 24 用
 *   `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 node scripts/update-amo-listing.mjs`
 *   （Node 原生 fetch 不读代理环境变量，需显式开启；CI Runner 直连无需代理）。
 *
 * 已知坑（官方行为如此，勿「修正」）：
 *   - listing GET 有 **360 秒 CDN 缓存**：刚 PATCH 完立刻 dry-run 可能读到旧值，
 *     等几分钟再验；判断写入是否生效以 PATCH 的 200 响应为准。
 *   - description 存的是 HTML 清洗后的文本（URL 变外链跳转、& 变 &amp;），
 *     比对已在 liveValue 里还原，不要再当差异上报。
 *   - previews 上传的位置字段拼写就是 `postion`；caption 创建时不接受，
 *     要建完再用 PATCH /previews/{id}/ 设。
 *   - 翻译字段必须传 {locale: 文案} 对象，纯字符串会被拒；某 locale 传 null 才是清除。
 *
 * 退出码：0 成功（含 dry-run）；1 失败（参数 / README 结构 / 网络 / 校验 / API）。
 */

import { createHmac, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const LISTING_PATH = resolve(REPO_ROOT, 'extension-infomation/store-listing.json');
const ASSETS_BASE = resolve(REPO_ROOT, 'extension-infomation/store-assets');

const AMO_API = 'https://addons.mozilla.org/api/v5';
// 与 manifest.firefox.json 的 browser_specific_settings.gecko.id 一致
const ADDON_ID = 'bookmark-sync-app';
const TIMEOUT_MS = 30_000;
const SUMMARY_MAX = 250; // AMO Summary 上限
// AMO 写接口限流很紧（实测连删 4 张就在第 4 张吃 429），写请求之间留间隔
const WRITE_GAP_MS = 10_000;

// ---------------------------------------------------------------- 小工具

/** 读 .env.submit（存在才读；不覆盖已有环境变量）——与 fetch-store-versions.mjs 同一约定。 */
function loadEnvFile(path = resolve(REPO_ROOT, '.env.submit')) {
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

function norm(s) {
  return (s ?? '').replace(/\r\n/g, '\n').trim();
}

function excerpt(s, n = 60) {
  const one = norm(s).replace(/\s+/g, ' ');
  return one.length > n ? `${one.slice(0, n)}…(共 ${norm(s).length} 字符)` : one;
}

/** GET/POST/PATCH/DELETE JSON，带超时；非 2xx 抛出可读错误。429 按响应体给的秒数等待后重试。 */
async function request(method, url, { headers = {}, body } = {}, retry = 0) {
  const res = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429 && retry < 3) {
    // AMO 写接口限流，响应体形如 "Request was throttled. Expected available in 57 seconds."
    const text = await res.text();
    const wait = (Number(/available in (\d+) seconds/i.exec(text)?.[1]) || 60) * 1000 + 2000;
    console.warn(`⏳ 429 限流，${Math.round(wait / 1000)}s 后重试…`);
    await new Promise((r) => setTimeout(r, wait));
    // JWT 只有 60 秒寿命：等了可能远超 60s，重试前必须重签（2026-10-25 实测：
    // 等待 17 分钟后带旧 token 重试 → 401 "Signature has expired"）
    const retryHeaders = { ...headers };
    if (
      typeof retryHeaders.Authorization === 'string' &&
      retryHeaders.Authorization.startsWith('JWT ')
    ) {
      Object.assign(retryHeaders, amoAuthHeaders());
    }
    return request(method, url, { headers: retryHeaders, body }, retry + 1);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `AMO ${method} ${url} → HTTP ${res.status} ${res.statusText}\n${text.slice(0, 500)}`,
    );
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`AMO 响应不是 JSON：${text.slice(0, 200)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 解析 listing 文案

/**
 * 从 store-listing.json 读出 AMO listing 目标文案。
 *
 * ★ 2026-10-25 起文案真源是 `extension-infomation/store-listing.json`，不再是 README。
 *   原因：Chrome 的 listing 是在 Dashboard 手改的加强版，Edge / AMO 停在旧版，
 *   三处互不一致，而 README 从未记录 Chrome 那版 —— 文案漂移没人发现。
 *   现在三家共用一份 JSON，改一处即可。
 *
 * 旧的 `parseListingFromReadme` 已删除：README 里的 §2/§3.1/§3.2/§7 仍是人读版，
 * 但不再是上传脚本的输入，避免两份真相。
 */
export function parseListingFromJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`store-listing.json 不是合法 JSON：${e.message}`);
  }
  const locales = data?.locales;
  if (!locales || typeof locales !== 'object') {
    throw new Error('store-listing.json 缺少 locales 字段');
  }
  const pick = (field) => {
    const out = {};
    for (const [loc, v] of Object.entries(locales)) {
      const val = v?.[field];
      if (typeof val === 'string' && val.trim()) out[loc] = val.trim();
    }
    return out;
  };
  const summary = pick('summary');
  const description = pick('description');
  if (!summary['en-US'] || !description['en-US']) {
    throw new Error('store-listing.json 缺少 en-US 的 summary 或 description');
  }
  return { summary, description };
}

function parseScreenshots(dir) {
  const entries = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();
  if (entries.length === 0) throw new Error(`截图目录里没有 png/jpg：${dir}`);
  return entries.map((f) => resolve(dir, f));
}

// ---------------------------------------------------------------- AMO API

function amoJwt(issuer, secret) {
  const iat = Math.floor(Date.now() / 1000);
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 })}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function amoAuthHeaders() {
  const issuer = process.env.FIREFOX_JWT_ISSUER;
  const secret = process.env.FIREFOX_JWT_SECRET;
  if (!issuer || !secret) {
    throw new Error(
      '缺少 FIREFOX_JWT_ISSUER / FIREFOX_JWT_SECRET（AMO → 开发者中心 → 管理 API 密钥）。\n' +
        '写入环境变量，或加到 gitignored 的 .env.submit（只读比对 / --dry-run 不需要凭证）。',
    );
  }
  // 每次请求签新 token（60 秒有效、jti 不可复用）
  return { Authorization: `JWT ${amoJwt(issuer, secret)}` };
}

async function fetchAddon() {
  // 带 bust 参数击穿 CDN 缓存（360s TTL）：刚写入完的复验否则会读到旧值
  return request('GET', `${AMO_API}/addons/addon/${ADDON_ID}/?_=${Date.now()}`, {
    headers: { Accept: 'application/json' },
  });
}

/**
 * AMO 会把 description 按 Markdown 渲染成 HTML 清洗后存储：裸 URL 包成
 * `<a href="https://prod.outgoing.prod.webservices.mozgcp.net/...">原文</a>` 外链跳转、
 * 编号/无序列表变 `<ol><li>`、`&` 转义成 `&amp;` 等。这是它的标准行为（页面上
 * 渲染成可点击链接/列表），不是写入失败；比对前先把这层表示还原成纯文本，
 * 否则每次 diff 都会误报。
 */
function normalizeAmoHtml(s) {
  return (
    (s ?? '')
      .replace(/<a\s[^>]*>([\s\S]*?)<\/a>/gi, '$1')
      // <ol>/<ul> 还原成 Markdown 源里的「1. / · 」前缀（AMO 把编号列表渲染成了 HTML 列表）
      .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
        const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(
          (m, i) => `${i + 1}. ${m[1].trim()}`,
        );
        return `\n${items.join('\n')}\n`;
      })
      .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
        const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(
          (m) => `· ${m[1].trim()}`,
        );
        return `\n${items.join('\n')}\n`;
      })
      .replace(/<\/?(?:li|p|h[1-6]|ol|ul|dl|dt|dd|blockquote|table|tr|td|th)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, '&')
  );
}

/**
 * 线上翻译字段值归一化：v5 对无 lang 参数的 GET 返回 {locale: 文案} 对象；
 * 兜底处理字符串形态（单 locale 时可能出现）。
 */
function liveValue(field, locale) {
  if (field == null) return '';
  const v = typeof field === 'string' ? field : (field[locale] ?? field._default ?? '');
  return normalizeAmoHtml(v);
}

/** 逐 locale 比对目标与线上，返回 {字段: {locale: {from, to}}}，只含有差异的项。 */
function diffMetadata(desired, live) {
  const diffs = {};
  for (const field of Object.keys(desired)) {
    for (const [locale, to] of Object.entries(desired[field])) {
      const from = liveValue(live[field], locale);
      if (norm(from) !== norm(to)) {
        (diffs[field] ??= {})[locale] = { from, to };
      }
    }
  }
  return diffs;
}

/** 只推有差异的字段与 locale；翻译字段必须是 {locale: 文案} 对象。 */
async function patchMetadata(changedLocalesByField) {
  const body = {};
  for (const [field, perLocale] of Object.entries(changedLocalesByField)) {
    body[field] = Object.fromEntries(
      Object.entries(perLocale).map(([locale, { to }]) => [locale, to]),
    );
  }
  return request('PATCH', `${AMO_API}/addons/addon/${ADDON_ID}/`, {
    headers: { ...amoAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deletePreview(id) {
  try {
    await request('DELETE', `${AMO_API}/addons/addon/${ADDON_ID}/previews/${id}/`, {
      headers: amoAuthHeaders(),
    });
  } catch (e) {
    // 上次运行中途失败留下的状态：id 已删掉时重跑不该报错（让替换流程可安全续跑）
    if (!/HTTP 404/.test(e.message)) throw e;
    console.log(`    (#${id} 已不存在，跳过)`);
  }
  await sleep(WRITE_GAP_MS);
}

/**
 * 上传一张截图。位置字段按官方文档拼写 `postion`（不是笔误）。
 * 不手动设 Content-Type，fetch 会给 FormData 自动生成带 boundary 的头。
 */
async function postPreview(filePath, position) {
  const type = /\.jpe?g$/i.test(filePath) ? 'image/jpeg' : 'image/png';
  const fd = new FormData();
  fd.append('image', new Blob([readFileSync(filePath)], { type }), basename(filePath));
  fd.append('postion', String(position));
  const out = await request('POST', `${AMO_API}/addons/addon/${ADDON_ID}/previews/`, {
    headers: amoAuthHeaders(),
    body: fd,
  });
  await sleep(WRITE_GAP_MS);
  return out;
}

// ---------------------------------------------------------------- 主流程

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    screenshots: false,
    screenshotsOnly: false,
    locales: null,
    screenshotsDir: resolve(ASSETS_BASE, 'en/1280x800'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--screenshots') opts.screenshots = true;
    else if (a === '--screenshots-only') {
      opts.screenshotsOnly = true;
      opts.screenshots = true;
    } else if (a === '--locales')
      opts.locales = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else if (a === '--screenshots-dir') opts.screenshotsDir = resolve(process.cwd(), argv[++i]);
    else throw new Error(`未知参数：${a}`);
  }
  if (opts.dryRun && opts.screenshotsOnly)
    throw new Error('--dry-run 与 --screenshots-only 不同时用：dry-run 不写任何东西');
  return opts;
}

function validate(desired, files) {
  for (const [locale, s] of Object.entries(desired.summary)) {
    if (s.length > SUMMARY_MAX) {
      throw new Error(`summary[${locale}] 长 ${s.length} 字符，超过 AMO 上限 ${SUMMARY_MAX}`);
    }
  }
  if (!desired.description['en-US'])
    throw new Error('en-US description 为空——store-listing.json 的 locales.en-US.description 异常');
  if (files.length > 5)
    console.warn(`⚠ 截图 ${files.length} 张：AMO 每个附加组件的截图数量有上限，超出部分可能被拒`);
}

export async function run(opts) {
  const listingText = readFileSync(LISTING_PATH, 'utf8');
  const desiredAll = parseListingFromJson(listingText);
  const desired = opts.locales
    ? Object.fromEntries(
        Object.entries(desiredAll).map(([field, perLocale]) => [
          field,
          Object.fromEntries(Object.entries(perLocale).filter(([l]) => opts.locales.includes(l))),
        ]),
      )
    : desiredAll;
  const files = opts.screenshots ? parseScreenshots(opts.screenshotsDir) : [];
  validate(desired, files);

  console.log(`读取线上 listing：${AMO_API}/addons/addon/${ADDON_ID}/`);
  const live = await fetchAddon();
  console.log(
    `✓ 线上：slug=${live.slug} default_locale=${live.default_locale} previews=${live.previews?.length ?? 0} 张\n`,
  );

  let hasMetadataChange = false;
  if (!opts.screenshotsOnly) {
    const diffs = diffMetadata(desired, live);
    const fields = Object.keys(diffs);
    if (fields.length === 0) {
      console.log('文案：线上与目标一致，无需更新。');
    } else {
      hasMetadataChange = true;
      for (const field of fields) {
        for (const [locale, { from, to }] of Object.entries(diffs[field])) {
          console.log(`${field}[${locale}] 有差异：`);
          console.log(`  - 线上: ${excerpt(from) || '(空)'}`);
          console.log(`  + 目标: ${excerpt(to)}`);
        }
      }
    }
  }

  if (opts.screenshots) {
    console.log(
      `\n截图：将替换为 ${opts.screenshotsDir} 下的 ${files.length} 张（先删线上 ${live.previews?.length ?? 0} 张，再按文件名顺序上传）：`,
    );
    for (const f of files) console.log(`  · ${basename(f)}`);
  }

  if (opts.dryRun) {
    console.log('\n--dry-run：未写入任何内容。');
    return 0;
  }
  if (!hasMetadataChange && !opts.screenshots) {
    console.log('\n没有需要写入的变更，结束。');
    return 0;
  }

  if (hasMetadataChange) {
    console.log('\n写入文案…');
    const changedLocalesByField = {};
    if (!opts.screenshotsOnly) {
      const diffs = diffMetadata(desired, live);
      for (const [field, perLocale] of Object.entries(diffs))
        changedLocalesByField[field] = perLocale;
    }
    await patchMetadata(changedLocalesByField);
    console.log('✓ PATCH 完成');
  }

  if (opts.screenshots) {
    console.log('\n替换截图…');
    for (const p of live.previews ?? []) {
      console.log(`  删除旧截图 #${p.id}…`);
      await deletePreview(p.id);
    }
    for (const [i, f] of files.entries()) {
      console.log(`  上传 ${basename(f)}（位置 ${i}）…`);
      await postPreview(f, i);
    }
    const after = await fetchAddon();
    const n = after.previews?.length ?? 0;
    if (n !== files.length) {
      throw new Error(
        `替换后线上截图 ${n} 张 ≠ 目标 ${files.length} 张——请检查后重跑 --screenshots-only`,
      );
    }
    console.log(`✓ 替换完成，线上 ${n} 张`);
  }

  console.log('\n完成。AMO listing 的元数据修改即时生效（无需重新审核）。');
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  loadEnvFile();
  return run(opts);
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && process.argv[1].endsWith('update-amo-listing.mjs');
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`✗ ${e?.message ?? e}`);
      if (process.env.UPDATE_AMO_DEBUG) console.error(e?.stack);
      process.exit(1);
    },
  );
}
