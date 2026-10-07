/**
 * src/ai/linkCheck.ts — 链接体检：批量探活 + AI 修复建议 + 采纳/撤销。
 *
 * ## 探活跑在设置页，不在 SW
 *
 * MV3 的 service worker 空闲约 30s 就被回收。上千条书签串行探活要跑几分钟，
 * 放 SW 里必然被腰斩，而且没有任何办法让它「跑完」。所以这一层由 **options 页面**
 * 驱动：页面是常驻的，进度、暂停、取消都有人按；关掉标签即中止（UI 上必须说明）。
 *
 * ## 为什么必须先授权广域 host 权限
 *
 * 扩展页面跨域 `fetch` 只有在持有对应 host 权限时才能拿到**真实状态码**。没有权限时
 * 请求会以 opaque 响应返回（`status === 0`），此时**读不到 404** —— 探活就变成了
 * 「所有站点都测不出来」。所以「授权探活权限」是使用本功能的前置步骤，不是可选项。
 *
 * ## HEAD 优先，失败退化 GET
 *
 * 很多站点不实现 HEAD（返回 405 / 501），这时用 GET 重试一次。GET 会拉回正文，
 * 但我们不看正文（`res.body` 不消费），代价可接受。
 *
 * ## 五种状态的判定口径
 *
 *   ok       2xx/3xx，且最终 URL 与原始 URL 同源同路径
 *   broken   404 / 410（明确的「没有这个资源」）
 *   redirect 跟随跳转后落在**同一个 host**
 *   changed  跟随跳转后落在**另一个 host**（域名迁移，如 v3.vuejs.org → vuejs.org）
 *   unknown  超时 / 网络错误 / 403 等反爬 / 5xx / opaque —— **不确定 ≠ 失效**
 *
 * ★ `unknown` 必须与 `broken` 严格分开。反爬、Cloudflare 拦截、公司内网站点都会
 * 大量落进 unknown，把它们标成「失效」会让用户误删好链接。
 *
 * ★ 本模块**只改 URL，不删节点**（`update` 而非 `remove`）。删节点会经 onRemoved
 * 产生墓碑并跨设备传播 —— 本项目已有两次「插件删用户数据」的事故。
 */

import { complete, extractJson, type AiConfig } from './provider.js';
import { chunk, hostOf, mapLimit } from './classify.js';
import { collectBookmarks } from './dedupe.js';
import type { ChromeTreeNode } from '../sync/index.js';

export type LinkStatus = 'ok' | 'broken' | 'redirect' | 'changed' | 'unknown';

/** 一条待探活的书签。 */
export interface LinkItem {
  id: string;
  title: string;
  url: string;
  /** 所在文件夹路径，供 UI 展示与 AI 参考。 */
  path: string;
}

/** 探活结果。 */
export interface LinkCheckResult extends LinkItem {
  status: LinkStatus;
  /** HTTP 状态码（拿不到时为 undefined）。 */
  httpStatus?: number;
  /** 跟随跳转后的最终 URL（发生跳转时才有）。 */
  finalUrl?: string;
  /** unknown 时的原因（超时 / 网络错误 / 状态码说明）。 */
  reason?: string;
}

/** 默认单请求超时。站点慢是常态，太短会把慢站误判成无法确认。 */
const DEFAULT_TIMEOUT_MS = 9000;
/** 相邻两次请求之间的基础间隔（实际会加 0.75~1.25 抖动）。 */
const DEFAULT_INTERVAL_MS = 400;
/** 同一 host 的最小间隔：防止某个站点占了整棵树的一大半时被连续猛敲。 */
const HOST_MIN_GAP_MS = 1200;

const REPAIR_BATCH_SIZE = 40;
const REPAIR_CONCURRENCY = 2;
const TITLE_MAX = 120;

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 树 → 全部 http(s) 书签（非 http(s) 的节点无法探活，直接跳过）。 */
export function collectHttpBookmarks(roots: ChromeTreeNode[]): LinkItem[] {
  return collectBookmarks(roots).filter((b) => isHttpUrl(b.url));
}

/** 同一个站点（忽略 www 与协议）—— 用于区分「同站跳转」与「换域名」。 */
function sameSite(a: string, b: string): boolean {
  const ha = hostOf(a);
  const hb = hostOf(b);
  return !!ha && ha === hb;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 探活单个 URL。
 *
 * @param opts.timeoutMs 单请求超时（HEAD 与随后的 GET 共用这一份预算）
 * @param opts.signal    外部取消（暂停/停止时掐掉当前这一个请求）
 */
export async function probeUrl(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Pick<LinkCheckResult, 'status' | 'httpStatus' | 'finalUrl' | 'reason'>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  // 记下是不是「超时导致的 abort」，好在错误分支里区分超时与其它网络错误
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  if (opts.signal?.aborted) ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);

  try {
    let res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        cache: 'no-store',
        credentials: 'omit',
      });
    }

    const status = res.status;
    const finalUrl = res.url || url;

    // opaque 响应（未授权 / 跨域被挡）：读不到状态码，只能算无法确认
    if (status === 0) {
      return { status: 'unknown', reason: 'opaque' };
    }
    if (status === 404 || status === 410) {
      return { status: 'broken', httpStatus: status };
    }
    if (status >= 400) {
      // 403 / 429 / 5xx：站点还活着，只是不给我们看 —— 不确定，不是失效
      return { status: 'unknown', httpStatus: status, reason: `HTTP ${status}` };
    }
    if (res.redirected || finalUrl !== url) {
      return {
        status: sameSite(url, finalUrl) ? 'redirect' : 'changed',
        httpStatus: status,
        finalUrl,
      };
    }
    return { status: 'ok', httpStatus: status };
  } catch (e) {
    if (timedOut) return { status: 'unknown', reason: 'timeout' };
    const msg = (e as { message?: unknown })?.message;
    return { status: 'unknown', reason: typeof msg === 'string' ? msg : 'network error' };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export interface LinkChecker {
  /** 跑到结束（或 stop()）后返回全部结果。 */
  start(): Promise<LinkCheckResult[]>;
  pause(): void;
  resume(): void;
  stop(): void;
}

/**
 * 串行限速的批量探活器。
 *
 * 串行而不是并发：并发几十个请求很容易触发站点风控，反而让大量结果落进 unknown。
 * 慢一点没关系，用户看得到进度。
 */
export function createLinkChecker(
  items: LinkItem[],
  o: {
    intervalMs?: number;
    timeoutMs?: number;
    onProgress?: (done: number, total: number, abnormal: number) => void;
  } = {},
): LinkChecker {
  const intervalMs = o.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: LinkCheckResult[] = [];
  const lastHostAt = new Map<string, number>();

  let paused = false;
  let stopped = false;
  let wake: (() => void) | null = null;

  const waitIfPaused = async (): Promise<void> => {
    while (paused && !stopped) {
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  };

  async function start(): Promise<LinkCheckResult[]> {
    let done = 0;
    let abnormal = 0;
    for (const it of items) {
      if (stopped) break;
      await waitIfPaused();
      if (stopped) break;

      // 同 host 节流：先等够最小间隔，再发请求
      const host = hostOf(it.url);
      const last = lastHostAt.get(host) ?? 0;
      const gap = last ? HOST_MIN_GAP_MS - (Date.now() - last) : 0;
      if (gap > 0) await sleep(gap);
      lastHostAt.set(host, Date.now());

      const r = await probeUrl(it.url, { timeoutMs });
      const full: LinkCheckResult = { ...it, ...r };
      results.push(full);
      done++;
      if (full.status !== 'ok') abnormal++;
      o.onProgress?.(done, items.length, abnormal);

      if (intervalMs > 0) await sleep(intervalMs * (0.75 + Math.random() * 0.5));
    }
    return results;
  }

  return {
    start,
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      wake?.();
      wake = null;
    },
    stop() {
      stopped = true;
      paused = false;
      wake?.();
      wake = null;
    },
  };
}

/** 一条 AI 修复建议。 */
export interface RepairSuggestion {
  id: string;
  oldUrl: string;
  newUrl: string;
  reason: string;
}

/**
 * 让模型给失效项猜一个「现在的地址」。
 *
 * 只发失效项（broken），不发 unknown —— unknown 大多是被反爬挡住，模型看不到真实
 * 页面也猜不准，白白外发数据。
 *
 * ★ prompt 里明确要求「没把握就不要给」。猜错的 URL 比不给建议更糟：用户会照着改，
 * 把一个能用的书签换成死链。
 */
export async function suggestRepairs(
  cfg: AiConfig,
  apiKey: string,
  broken: LinkCheckResult[],
): Promise<{ items: RepairSuggestion[]; usage?: { input: number; output: number } }> {
  if (broken.length === 0) return { items: [] };

  const batches = chunk(broken, REPAIR_BATCH_SIZE);
  const settled = await mapLimit(batches, REPAIR_CONCURRENCY, (batch) =>
    suggestOneBatch(cfg, apiKey, batch).catch(() => null),
  );

  const items: RepairSuggestion[] = [];
  let input = 0;
  let output = 0;
  let sawUsage = false;
  for (const r of settled) {
    if (!r) continue;
    items.push(...r.items);
    if (r.usage) {
      sawUsage = true;
      input += r.usage.input;
      output += r.usage.output;
    }
  }
  return { items, usage: sawUsage ? { input, output } : undefined };
}

async function suggestOneBatch(
  cfg: AiConfig,
  apiKey: string,
  batch: LinkCheckResult[],
): Promise<{ items: RepairSuggestion[]; usage?: { input: number; output: number } }> {
  const list = batch
    .map((b, i) => {
      const title = (b.title || b.url).slice(0, TITLE_MAX);
      const host = hostOf(b.url) || '(unknown)';
      return `${i}. ${title} (${host})\n   dead url: ${b.url}`;
    })
    .join('\n');

  const prompt =
    `These ${batch.length} bookmarks are dead (the URL returns 404/410).\n\n${list}\n\n` +
    `For each one, suggest the URL where that content most likely lives now — ` +
    `for example a documentation site that moved to a new domain, or a page whose ` +
    `path was renamed. Use the title and the site's known URL patterns to infer it.\n\n` +
    `Rules:\n` +
    `- Return an entry ONLY if you have a concrete, specific URL you are reasonably confident about.\n` +
    `- If you are not confident, OMIT that index entirely. Omitting is much better than guessing:\n` +
    `  a wrong URL replaces a recoverable bookmark with a broken one.\n` +
    `- Never return a URL that is the same as the dead one.\n` +
    `- Use the numeric index, not the title.\n` +
    `- reason: one short sentence explaining the inference (e.g. "docs moved to vuejs.org").\n\n` +
    `Return JSON: {"items":[{"i":0,"url":"https://...","reason":"..."}]}`;

  const res = await complete(cfg, apiKey, {
    messages: [{ role: 'user', content: prompt }],
    json: true,
    maxTokens: 1024,
    temperature: 0,
  });

  const raw = extractJson(res.text) as { items?: unknown };
  return { items: normalizeSuggestions(raw?.items, batch), usage: res.usage };
}

/** 校验模型返回的修复建议：下标在范围内、URL 合法且与旧值不同。 */
function normalizeSuggestions(raw: unknown, batch: LinkCheckResult[]): RepairSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RepairSuggestion[] = [];

  for (const it of raw.slice(0, 200)) {
    if (!it || typeof it !== 'object') continue;
    const { i, url, reason } = it as { i?: unknown; url?: unknown; reason?: unknown };
    if (typeof i !== 'number' || !Number.isInteger(i)) continue;
    if (i < 0 || i >= batch.length) continue;
    if (typeof url !== 'string' || !isHttpUrl(url.trim())) continue;
    const target = batch[i];
    if (seen.has(target.id)) continue;
    const next = url.trim();
    if (next === target.url) continue;
    seen.add(target.id);
    out.push({
      id: target.id,
      oldUrl: target.url,
      newUrl: next,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : '',
    });
  }
  return out;
}

/** 写操作所需的最小 API 面（便于单测注入 fake）。 */
export interface RepairBookmarksAPI {
  update(id: string, changes: { url: string }): Promise<unknown>;
}

/** apply 前的快照，供撤销使用。 */
export interface RepairSnapshot {
  updated: Array<{ id: string; oldUrl: string }>;
}

export interface RepairApplyResult {
  ok: boolean;
  snapshot: RepairSnapshot;
  applied: number;
  failures: Array<{ id: string; message: string }>;
}

/**
 * 采纳并更新：把书签的 URL 换成建议值。
 *
 * **只 update，不 remove**（见文件头）。返回的快照带上旧 URL，撤销时原样写回。
 * 半程失败不回滚 —— 已成功的保留，把失败项如实报给用户（与 organize.applyPlan 同款）。
 */
export async function applyRepairs(
  chrome: RepairBookmarksAPI,
  targets: Array<{ id: string; oldUrl: string; newUrl: string }>,
  onProgress?: (done: number, total: number) => void,
): Promise<RepairApplyResult> {
  const snapshot: RepairSnapshot = { updated: [] };
  const failures: Array<{ id: string; message: string }> = [];
  let done = 0;

  for (const target of targets) {
    try {
      await chrome.update(target.id, { url: target.newUrl });
      snapshot.updated.push({ id: target.id, oldUrl: target.oldUrl });
    } catch (e) {
      failures.push({
        id: target.id,
        message: (e as { message?: string })?.message ?? String(e),
      });
    }
    done++;
    onProgress?.(done, targets.length);
  }

  return {
    ok: failures.length === 0,
    snapshot,
    applied: snapshot.updated.length,
    failures,
  };
}

/** 撤销：把快照里的旧 URL 写回去。仅本次会话内有效（快照不落盘）。 */
export async function revertRepairs(
  chrome: RepairBookmarksAPI,
  snapshot: RepairSnapshot,
): Promise<{ reverted: number; failed: Array<{ id: string; message: string }> }> {
  let reverted = 0;
  const failed: Array<{ id: string; message: string }> = [];
  for (const item of snapshot.updated) {
    try {
      await chrome.update(item.id, { url: item.oldUrl });
      reverted++;
    } catch (e) {
      failed.push({ id: item.id, message: (e as { message?: string })?.message ?? String(e) });
    }
  }
  return { reverted, failed };
}
