/**
 * src/ai/semanticDedupe.ts — AI 语义判重（同内容、不同站点）。
 *
 * ## 与 ai/dedupe.ts 的分工
 *
 * `dedupe.ts` 处理**精确重复**：规范化 URL 完全相同（含 AMP / 移动端变体 / 追踪参数）。
 * 那是确定性计算，零 token、零外发、可以全量跑。
 *
 * 本模块处理它抓不到的那一类：**同一个东西的两个不同 URL**。典型场景是
 * 「英文原文 + 中文翻译」「博客原文 + 平台转载」「同一篇论文的两个托管点」——
 * URL 毫无关系，标题也可能一个中文一个英文。这只能靠模型读标题判断。
 *
 * ## 为什么不能两两组合
 *
 * 1000 条书签两两组合是 50 万对，无论 prompt 还是花费都不可接受。所以先做**本地
 * 候选生成**：用倒排索引只把「共享稀有词」的条目凑成对，再用标题 / slug 相似度打分
 * 取每条的前 N 个候选。模型只看这批候选，量级降到几十到几百对。
 *
 * ★ 本地打分**只决定「把谁送去问模型」**，不决定判定结果 —— 所以阈值不必精确，
 * 漏掉的候选最多是「少发现一组相似」，不会产生假重复。真正的判定在模型那边。
 *
 * ## 只报告，不删除
 *
 * 与 dedupe.ts 同一条铁律：本模块只产出建议（保留哪条 + 置信度 + 理由），
 * 不动 `chrome.bookmarks`。本项目已有两次「插件删用户数据」的事故，不做第三次。
 */

import { complete, extractJson, type AiConfig } from './provider.js';
import { chunk, hostOf, mapLimit } from './classify.js';
import { pickKeeper } from './dedupe.js';
import { tokenize } from './qa.js';

/** 参与语义判重的一条书签。 */
export interface SemanticItem {
  id: string;
  title: string;
  url: string;
}

/** 一对本地候选（a/b 是 SemanticItem.id）。 */
export interface CandidatePair {
  a: string;
  b: string;
  /** 本地相似度得分，仅用于排序与置信度下调，不发模型。 */
  score: number;
}

/** 一组被判为「同一内容」的书签。 */
export interface SemanticGroup {
  /** 建议保留的那条（规则与 dedupe.pickKeeper 同源）。 */
  keepId: string;
  /** 建议处理掉的其余条目。UI 只标出来，由用户决定。 */
  dupIds: string[];
  confidence: 'high' | 'medium';
  reason: string;
}

export interface SemanticResult {
  groups: SemanticGroup[];
  usage?: { input: number; output: number };
  /** 用户在批次边界主动取消（signal.aborted）。已完成批次结果保留，未发起的不发。 */
  aborted?: boolean;
}

const DEFAULT_MAX_PER_ITEM = 5;
const DEFAULT_MIN_SCORE = 0.5;

/** 文档频率上限：出现太频繁的词（www / com / 教程）不参与候选，否则一个词就把
 *  上千条连成一团，倒排索引退化成两两组合。 */
const MAX_DF_ABS = 50;
const MAX_DF_RATIO = 0.15;
/** 候选对总数硬上限，兜住病态输入（大量近似标题）导致的组合爆炸。 */
const MAX_PAIRS = 20000;

const BATCH_SIZE = 60;
const CONCURRENCY = 3;
const TITLE_MAX = 120;

/** 本地得分到这个值以上，才允许模型给的 high 保持为 high。 */
const HIGH_SCORE = 1;

/** 取 URL 末段当 slug（去扩展名、把分隔符换成空格），用于比较「是不是同一篇」。 */
function slugOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length - 1] ?? '';
    return last.replace(/\.(?:html?|php|aspx?|jsp)$/i, '').replace(/[-_]+/g, ' ');
  } catch {
    return '';
  }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}\u2026`;
}

/**
 * 本地候选生成：倒排索引 → 打分 → 每条取前 N 个。
 *
 * 打分权重（都是启发式，只影响「送给谁」）：
 *   - 标题 token Jaccard × 2
 *   - slug token Jaccard × 1.5
 *   - 跨站 +0.3（本功能的价值就在跨站，同站重复多半已被精确判重抓到）
 */
export function buildCandidates(
  items: SemanticItem[],
  opts: { maxPerItem?: number; minScore?: number } = {},
): CandidatePair[] {
  const maxPerItem = opts.maxPerItem ?? DEFAULT_MAX_PER_ITEM;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;
  const n = items.length;
  if (n < 2) return [];

  const titleTokens = items.map((it) => new Set(tokenize(it.title ?? '')));
  const slugTokens = items.map((it) => new Set(tokenize(slugOf(it.url))));

  // 倒排索引：token → 含它的条目下标
  const index = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const t of titleTokens[i]) {
      const arr = index.get(t);
      if (arr) arr.push(i);
      else index.set(t, [i]);
    }
  }
  const maxDf = Math.min(MAX_DF_ABS, Math.max(2, Math.floor(n * MAX_DF_RATIO)));

  const scores = new Map<string, number>();
  let budget = MAX_PAIRS;

  for (const arr of index.values()) {
    if (arr.length > maxDf) continue; // 太常见 → 不是区分性信号
    for (let x = 0; x < arr.length && budget > 0; x++) {
      for (let y = x + 1; y < arr.length && budget > 0; y++) {
        const i = arr[x];
        const j = arr[y];
        const k = `${i}\u0001${j}`;
        if (scores.has(k)) continue; // 多词共享只算一次（得分基于 Jaccard，不累加）
        const crossSite = hostOf(items[i].url) !== hostOf(items[j].url) ? 0.3 : 0;
        const s =
          jaccard(titleTokens[i], titleTokens[j]) * 2 +
          jaccard(slugTokens[i], slugTokens[j]) * 1.5 +
          crossSite;
        if (s >= minScore) scores.set(k, s);
        budget--;
      }
    }
    if (budget <= 0) break;
  }

  const ranked = [...scores.entries()]
    .map(([k, score]) => {
      const [i, j] = k.split('\u0001').map(Number);
      return { i, j, score };
    })
    .sort((a, b) => b.score - a.score);

  // 每条最多出现在 maxPerItem 个候选里：防止某条热门书签把候选表吃满
  const used = Array.from({ length: n }, () => 0);
  const out: CandidatePair[] = [];
  for (const p of ranked) {
    if (used[p.i] >= maxPerItem || used[p.j] >= maxPerItem) continue;
    used[p.i]++;
    used[p.j]++;
    out.push({ a: items[p.i].id, b: items[p.j].id, score: p.score });
  }
  return out;
}

/**
 * 把候选交给模型判定，返回成组的建议。
 *
 * @param items 全部候选条目（用于把 id 映射回标题/URL）
 * @param pairs buildCandidates 的产出
 */
export async function classifySemanticDupes(
  cfg: AiConfig,
  apiKey: string,
  items: SemanticItem[],
  pairs: CandidatePair[],
  signal?: AbortSignal,
): Promise<SemanticResult> {
  if (pairs.length === 0) return { groups: [] };

  const byId = new Map(items.map((it) => [it.id, it]));
  const scoreOf = new Map<string, number>();
  for (const p of pairs) scoreOf.set(pairKey(p.a, p.b), p.score);

  const batches = chunk(pairs, BATCH_SIZE);
  let aborted = false;
  const settled = await mapLimit(batches, CONCURRENCY, (batch) => {
    // ★ 批次边界：已取消则不再发起本批，已完成的批次结果保留（见 classify.ts 同名注释）。
    if (signal?.aborted) {
      aborted = true;
      return Promise.resolve(null);
    }
    return classifyOneBatch(cfg, apiKey, batch, byId, signal).catch(() => null);
  });

  const found: Array<{ a: string; b: string; confidence: 'high' | 'medium'; reason: string }> = [];
  let input = 0;
  let output = 0;
  let sawUsage = false;
  for (const r of settled) {
    if (!r) continue; // 整批失败或被取消：跳过，不猜
    found.push(...r.pairs);
    if (r.usage) {
      sawUsage = true;
      input += r.usage.input;
      output += r.usage.output;
    }
  }

  return {
    groups: groupPairs(found, byId, scoreOf),
    usage: sawUsage ? { input, output } : undefined,
    aborted: aborted || undefined,
  };
}

async function classifyOneBatch(
  cfg: AiConfig,
  apiKey: string,
  batch: CandidatePair[],
  byId: Map<string, SemanticItem>,
  signal?: AbortSignal,
): Promise<{
  pairs: Array<{ a: string; b: string; confidence: 'high' | 'medium'; reason: string }>;
  usage?: { input: number; output: number };
}> {
  // 该批涉及的条目去重后统一编号，prompt 里只用下标
  const ids: string[] = [];
  const idxOf = new Map<string, number>();
  for (const p of batch) {
    for (const id of [p.a, p.b]) {
      if (!idxOf.has(id)) {
        idxOf.set(id, ids.length);
        ids.push(id);
      }
    }
  }

  const list = ids
    .map((id, i) => {
      const it = byId.get(id);
      if (!it) return `${i}. (missing)`;
      const title = truncate(it.title.trim() || it.url, TITLE_MAX);
      const meta = [hostOf(it.url), slugOf(it.url)].filter(Boolean).join(' / ');
      return meta ? `${i}. ${title} (${meta})` : `${i}. ${title}`;
    })
    .join('\n');

  const prompt =
    `Below are ${ids.length} bookmarks, each as "index. title (site / slug)".\n\n${list}\n\n` +
    `Task: report pairs that are the SAME underlying content or the same resource — ` +
    `for example an article and its re-post on another platform, an original and its ` +
    `translation, or the same paper hosted in two places.\n\n` +
    `Rules:\n` +
    `- Only report pairs you are genuinely confident about. Reporting none is fine.\n` +
    `- Two bookmarks that merely share a topic are NOT duplicates. They must be the same item.\n` +
    `- Use the numeric index, not the title.\n` +
    `- "high" only when it is clearly the same item; otherwise "medium".\n\n` +
    `Return JSON: {"pairs":[{"i":0,"j":3,"confidence":"high","reason":"short reason"}]}`;

  const res = await complete(cfg, apiKey, {
    messages: [{ role: 'user', content: prompt }],
    json: true,
    maxTokens: 1024,
    temperature: 0,
    signal,
  });

  const raw = extractJson(res.text) as { pairs?: unknown };
  return { pairs: normalizePairs(raw?.pairs, ids), usage: res.usage };
}

/**
 * 校验模型返回的配对。小模型的输出不可全信，四道过滤：
 *   1. i/j 必须是整数且在批内（防越界 / 串批）；
 *   2. i ≠ j；
 *   3. 同一对只收一次（顺序无关）；
 *   4. confidence 只认 high / medium。
 */
function normalizePairs(
  raw: unknown,
  ids: string[],
): Array<{ a: string; b: string; confidence: 'high' | 'medium'; reason: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ a: string; b: string; confidence: 'high' | 'medium'; reason: string }> = [];

  for (const p of raw.slice(0, 200)) {
    if (!p || typeof p !== 'object') continue;
    const { i, j, confidence, reason } = p as {
      i?: unknown;
      j?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    if (typeof i !== 'number' || !Number.isInteger(i)) continue;
    if (typeof j !== 'number' || !Number.isInteger(j)) continue;
    if (i < 0 || j < 0 || i >= ids.length || j >= ids.length) continue;
    if (i === j) continue;
    const a = ids[i];
    const b = ids[j];
    const k = pairKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      a,
      b,
      confidence: confidence === 'high' ? 'high' : 'medium',
      reason: typeof reason === 'string' ? reason.trim().slice(0, 200) : '',
    });
  }
  return out;
}

/**
 * 把配对合并成组（连通分量：三条互相同源会合成一组），并挑出保留项。
 *
 * 组的置信度取**组内最低**的那个 —— 一条链上只要有一环是 medium，整组就不该
 * 冒充高置信。
 */
function groupPairs(
  pairs: Array<{ a: string; b: string; confidence: 'high' | 'medium'; reason: string }>,
  byId: Map<string, SemanticItem>,
  scoreOf: Map<string, number>,
): SemanticGroup[] {
  const adj = new Map<string, Set<string>>();
  const pairMeta = new Map<string, { confidence: 'high' | 'medium'; reason: string }>();
  for (const p of pairs) {
    if (!byId.has(p.a) || !byId.has(p.b)) continue;
    if (!adj.has(p.a)) adj.set(p.a, new Set());
    if (!adj.has(p.b)) adj.set(p.b, new Set());
    adj.get(p.a)!.add(p.b);
    adj.get(p.b)!.add(p.a);
    pairMeta.set(pairKey(p.a, p.b), { confidence: p.confidence, reason: p.reason });
  }

  const visited = new Set<string>();
  const groups: SemanticGroup[] = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    // BFS 取连通分量
    const comp: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length) {
      const cur = queue.pop()!;
      comp.push(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    if (comp.length < 2) continue;

    const members = comp
      .map((id) => byId.get(id))
      .filter((x): x is SemanticItem => !!x)
      .map((x) => ({ id: x.id, title: x.title ?? '', url: x.url ?? '' }));
    if (members.length < 2) continue;

    const keepId = pickKeeper(members);

    // 组置信度 = 组内最低（含本地得分的二次校验）
    let confidence: 'high' | 'medium' = 'high';
    let reason = '';
    for (let x = 0; x < comp.length; x++) {
      for (let y = x + 1; y < comp.length; y++) {
        const meta = pairMeta.get(pairKey(comp[x], comp[y]));
        if (!meta) continue;
        const local = scoreOf.get(pairKey(comp[x], comp[y])) ?? 0;
        // 模型说 high 但本地相似度很低 → 下调为 medium（模型判断作二次因子，取低者）
        if (meta.confidence !== 'high' || local < HIGH_SCORE) confidence = 'medium';
        if (!reason && meta.reason) reason = meta.reason;
      }
    }

    groups.push({
      keepId,
      dupIds: comp.filter((id) => id !== keepId),
      confidence,
      reason,
    });
  }

  // 组越大越先看；同大小按 keepId 稳定排序
  groups.sort((a, b) => b.dupIds.length - a.dupIds.length || (a.keepId < b.keepId ? -1 : 1));
  return groups;
}
