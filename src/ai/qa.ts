/**
 * src/ai/qa.ts — 书签问答的**本地检索层**。
 *
 * ## 为什么必须先本地筛，不能整棵树发过去
 *
 * 两个理由，任一都足够：
 *
 * 1. **成本**：书签上千条是常态，全量塞进 prompt 是几十万 token 的量级，用户按
 *    自己的 key 付费，一次提问烧掉几块钱不可接受。
 * 2. **隐私**：E2EE 的意义是「只有我授权的数据才离开本机」。为了回答「我存的那个
 *    React 文章在哪」，没必要把用户的其他九百条书签一起发出去。
 *
 * 所以流程是：本地按关键词打分挑出 top-N 候选 → 只把候选发给模型 → 模型基于
 * 候选作答。检索在本地完成，**发出的数据量由问题决定，而不是由书签总量决定**。
 *
 * ## 为什么不用向量检索
 *
 * 向量要跑 embedding 模型（体积 + 又要一次 API 往返），而书签问答的召回场景很窄：
 * 用户问的通常就是他记得的标题里的词。关键词打分在这个场景够用，且零依赖、零延迟。
 * 召回不够时用户换个词就行 —— 比为此引入一个 embedding 栈划算得多。
 */

import type { ChromeTreeNode } from '../sync/index.js';

/** 参与问答的一条书签（已 flatten，带所在文件夹路径）。 */
export interface QaCandidate {
  /** chrome.bookmarks 的节点 id，用于把模型引用映射回原书签。 */
  id: string;
  title: string;
  url: string;
  /** 所在文件夹路径，如「书签栏 / 技术 / Rust」。给模型定位上下文。 */
  path: string;
  /** 本地相关性得分，仅用于排序，不发给模型。 */
  score: number;
}

/** 默认候选上限。40 条 × 每条约 80 字符 ≈ 3k token，配合几百字的回答足够，且很便宜。 */
export const DEFAULT_CANDIDATE_LIMIT = 40;

const TITLE_MAX = 120;
const URL_MAX = 200;
const PATH_MAX_DEPTH = 6;

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

/**
 * 查询切词。
 *
 * 中文没有空格，按空白切会把整句切成一个词（"我存的React教程" → 一个 token，
 * 和标题里任何片段都匹配不上）。所以逐字符扫描，把输入攒成两类段分别处理：
 *   - 拉丁/数字段：整段作为词（长度 ≥2 才收 —— 单字母噪音太大）
 *   - CJK 段：取全部 2-gram（单字太散、整段太长，2-gram 是这类场景的常用折中）
 *
 * 混排也要正确处理：「我存的React教程」应产出 我存 / 存的 / react / 教程，
 * 而不是把 React 拆成 r、e、a、c、t 五个单字符 token（那会让几乎所有书签都命中）。
 *
 * 结果去重并保持稳定顺序，便于测试与调试。
 */
export function tokenize(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  const flushCjk = () => {
    if (cjk.length === 1) push(cjk);
    else for (let i = 0; i + 1 < cjk.length; i++) push(cjk.slice(i, i + 2));
    cjk = '';
  };
  const flushWord = () => {
    if (word.length >= 2) push(word.toLowerCase());
    word = '';
  };

  let cjk = '';
  let word = '';
  for (const ch of query) {
    if (CJK.test(ch)) {
      flushWord();
      cjk += ch;
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      flushCjk();
      word += ch;
    } else {
      // 分隔符：两类段都收口（连字符、点号、空格、标点 …）
      flushCjk();
      flushWord();
    }
  }
  flushCjk();
  flushWord();

  return out;
}

/** 树 → 扁平书签列表（只要书签节点，跳过文件夹；顺带记下所在文件夹路径）。 */
export function flattenBookmarks(
  roots: ChromeTreeNode[],
  maxDepth = PATH_MAX_DEPTH,
): Array<Omit<QaCandidate, 'score'>> {
  const out: Array<Omit<QaCandidate, 'score'>> = [];

  const walk = (nodes: ChromeTreeNode[], trail: string[], depth: number) => {
    for (const n of nodes) {
      const title = (n.title ?? '').trim();
      if (n.url) {
        out.push({ id: n.id, title, url: n.url, path: trail.join(' / ') });
      } else if (n.children && depth < maxDepth) {
        walk(n.children, [...trail, title].filter(Boolean), depth + 1);
      }
    }
  };

  walk(roots, [], 0);
  return out;
}

/**
 * 本地打分并取 top-N。
 *
 * 权重设计：标题命中 3 分、文件夹路径 1 分、URL 1 分 —— 用户记的是**标题**，
 * URL 是兜底（域名或 slug 有时更准）。整串查询命中标题额外 +10，因为「原样记得」
 * 是最强的相关性信号。
 *
 * 得分为 0 的一律丢弃（宁可返回空让用户换词，也不要塞一堆无关书签去消耗 token）。
 * 全部书签都是 0 分时返回空数组。
 */
export function searchBookmarks(
  roots: ChromeTreeNode[],
  query: string,
  limit = DEFAULT_CANDIDATE_LIMIT,
): QaCandidate[] {
  const tokens = tokenize(query);
  const all = flattenBookmarks(roots);
  if (tokens.length === 0) return [];

  const needle = query.trim().toLowerCase();
  const scored: QaCandidate[] = [];

  for (const b of all) {
    const title = b.title.toLowerCase();
    const url = b.url.toLowerCase();
    const path = b.path.toLowerCase();

    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      else if (path.includes(t)) score += 1;
      else if (url.includes(t)) score += 1;
    }
    if (needle.length >= 2 && title.includes(needle)) score += 10;
    if (score > 0) scored.push({ ...b, score });
  }

  // 得分高的在前；同分时标题短的在前（更可能是用户想找的那条精确目标）
  scored.sort((a, z) => z.score - a.score || a.title.length - z.title.length);
  return scored.slice(0, limit);
}

/** 问答场景的 system 指令（provider 的默认那份是给归类写的，不适用）。 */
export const QA_SYSTEM_PROMPT =
  'You answer questions about the user\u2019s own bookmarks. ' +
  'Answer in the same language as the question. Be concise and concrete. ' +
  'Use ONLY the bookmark list provided in the message. ' +
  'If the list does not contain the answer, say so plainly \u2014 never invent titles or URLs. ' +
  'Cite the bookmarks you rely on by their index, like [#3].';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);

/**
 * 拼出问答请求的用户消息。
 *
 * 候选为空时也照常发给模型 —— 让模型如实说「没找到」，比在客户端硬编码一句
 * 「没找到」更自然（它还能顺势引导用户换关键词）。但要在 prompt 里说清
 * 「列表是空的」，否则模型会自己编。
 */
export function buildQaPrompt(question: string, candidates: QaCandidate[]): string {
  if (candidates.length === 0) {
    return (
      `The user asked: ${question}\n\n` +
      `Local search over their bookmarks returned NO matches for this question.\n` +
      `Tell them plainly that no matching bookmarks were found in what was searched, ` +
      `and suggest a more specific keyword. Do not invent any bookmark.`
    );
  }

  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${clip(c.title || '(no title)', TITLE_MAX)}` +
        `\n   url: ${clip(c.url, URL_MAX)}` +
        (c.path ? `\n   folder: ${c.path}` : ''),
    )
    .join('\n');

  return (
    `The user asked: ${question}\n\n` +
    `Here are ${candidates.length} bookmarks that matched a local keyword search on their machine ` +
    `(this is a partial list, not all of their bookmarks):\n\n${list}\n\n` +
    `Answer the question using only the list above. Cite with [#n]. ` +
    `If none of them actually answers the question, say so instead of guessing.`
  );
}
