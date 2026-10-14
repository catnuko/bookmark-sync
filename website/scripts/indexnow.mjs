// IndexNow 提交 —— 把 sitemap 里的全部 URL 推给 api.indexnow.org，让 Bing 系立即来抓。
//
// 用法：
//   node scripts/indexnow.mjs            → 提交 sitemap 全部 URL
//   node scripts/indexnow.mjs --dry-run  → 只打印将要提交的 URL，不发请求
//
// ★ 为什么不用 Bing 后台那个「IndexNow」页：它是营销落地页，没有可操作的功能。
//   IndexNow 本质是一个开放 HTTP 协议（Bing / Yandex / Seznam / Naver 共用同一端点），
//   直接 POST 即可。
//
// ★ 只对 Bing 系生效：**Google 不支持 IndexNow**，Google 侧仍要走 GSC 的
//   「请求编入索引」+ 外链。
//
// ★ key 文件必须在站点根目录：public/<key>.txt（文件名 = key，文件内容 = key）。
//   Next 静态导出把 public/ 原样拷进 out/，Vercel 直接服务该路径。
//
// 本机（国内）跑要走代理 —— Node 的 fetch 不读 HTTP_PROXY 环境变量，需显式打开：
//   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 node scripts/indexnow.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SITE = 'https://www.bookmark-sync.top';
const HOST = 'www.bookmark-sync.top';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const TIMEOUT_MS = 20_000;

const dryRun = process.argv.includes('--dry-run');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** key 文件 = public/ 下那个「文件名与内容相同」的 .txt（文件名即 key）。 */
function readKey() {
  const pub = resolve(root, 'public');
  const files = readdirSync(pub).filter((f) => f.endsWith('.txt'));
  const key = files
    .map((f) => ({
      name: f.replace(/\.txt$/, ''),
      body: readFileSync(resolve(pub, f), 'utf8').trim(),
    }))
    .find((k) => k.name === k.body && /^[a-zA-Z0-9-]{8,128}$/.test(k.name));

  if (!key) {
    throw new Error(
      `[indexnow] public/ 下没有合法的 key 文件（需 <key>.txt，文件名与内容同为 8~128 位十六进制）。` +
        `当前 .txt：${files.join(', ') || '（无）'}`,
    );
  }
  return key.name;
}

const get = (url) => fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });

/** 等 key 文件上线 —— 部署有延迟，提交前必须先能取到它，否则 IndexNow 会判 422。 */
async function waitForKeyLive(key) {
  const url = `${SITE}/${key}.txt`;
  for (let i = 1; i <= 10; i++) {
    try {
      const res = await get(url);
      if (res.ok && (await res.text()).trim() === key) return url;
      console.log(`  key 文件未就绪（HTTP ${res.status}），${i}/10 重试…`);
    } catch (err) {
      console.log(`  key 文件不可达（${err.message}），${i}/10 重试…`);
    }
    await sleep(15_000);
  }
  throw new Error(`[indexnow] key 文件未上线：${url} —— 先把 public/${key}.txt 部署上去再跑`);
}

/** 线上 sitemap.xml 里的全部 <loc>。 */
async function readSitemapUrls() {
  const res = await get(`${SITE}/sitemap.xml`);
  if (!res.ok) throw new Error(`[indexnow] 拉取 sitemap 失败：HTTP ${res.status}`);
  const urls = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!urls.length) throw new Error('[indexnow] sitemap 里没有 <loc>');
  return urls;
}

async function main() {
  const key = readKey();
  const urls = await readSitemapUrls();
  console.log(`[indexnow] key = ${key}，sitemap 共 ${urls.length} 条 URL`);

  if (dryRun) {
    console.log('[indexnow] --dry-run，不发请求。将提交：');
    for (const u of urls) console.log(`  ${u}`);
    return;
  }

  const keyLocation = await waitForKeyLive(key);
  console.log(`[indexnow] key 文件已就绪：${keyLocation}`);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ host: HOST, key, keyLocation, urlList: urls }),
  });

  // IndexNow 成功码：200 = 已接收；202 = 已接收但 key 待校验。
  if (res.ok) {
    console.log(
      `[indexnow] ✅ 提交成功（HTTP ${res.status}），${urls.length} 条 URL 已推给 Bing 系引擎`,
    );
    return;
  }

  const body = await res.text().catch(() => '');
  const hint = {
    400: '请求格式错误',
    403: 'key 无效或未启用',
    422: 'URL 不属于该 host，或 key 文件找不到',
    429: '提交过于频繁，稍后再试',
  }[res.status];
  throw new Error(
    `[indexnow] ❌ 提交失败 HTTP ${res.status}${hint ? `（${hint}）` : ''}${body ? `：${body.slice(0, 300)}` : ''}`,
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
