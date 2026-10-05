/**
 * src/ai/classify.ts — 批量归类：把一堆书签按主题分到文件夹。
 *
 * ## 为什么不每次只问一个
 *
 * 逐条问 = N 次网络往返 × N 份 token。1000 条书签要跑十几分钟且烧掉大量额度。
 * 这里改成**一次请求处理一批**：把 (title, url) 列表塞进 prompt，让模型返回
 * 「分组名 → 书签下标数组」的映射。一次往返，成本降一到两个数量级。
 *
 * ## 分批
 *
 * 单次请求不能无限塞：标题截断到 120 字符、每批 60 条，prompt 体量可控。
 * 批与批之间**并发**跑（各批互不依赖），但并发上限 3 —— 再高容易触发服务端
 * 限流，反而更慢。
 *
 * ## 输出不直接落地
 *
 * 模型只给「建议结构」，真正写 chrome.bookmarks 由调用方（UI 层）在用户确认后
 * 执行。本模块**只读书签、只返回方案，不做任何写操作** —— 改用户书签树是必须
 * 显式确认的动作，不能由一次 API 返回就自动生效。
 */

import { complete, extractJson, type AiConfig } from './provider.js';
import type { ChromeTreeNode } from '../sync/index.js';

/** 参与归类的书签最小信息。只取需要的两个字段，不把整棵树塞给模型。 */
export interface ClassifyItem {
  /** chrome.bookmarks 的节点 id，仅用于把结果映射回原书签。 */
  id: string;
  title: string;
  url: string;
}

/** 一个建议的文件夹及其成员。 */
export interface ClassifyGroup {
  /** 建议的文件夹名（模型给的名字，可能与现有文件夹重名）。 */
  folder: string;
  /** 对应 ClassifyItem.id 的列表。 */
  ids: string[];
}

/** 单次调用的整体结果，含失败信息以便如实告知用户。 */
export interface ClassifyResult {
  groups: ClassifyGroup[];
  /** 未能归类（模型没返回、超时、报错）的书签 id。 */
  unclassified: string[];
  usage?: { input: number; output: number };
}

const BATCH_SIZE = 60;
const CONCURRENCY = 3;
const TITLE_MAX = 120;

/**
 * 已有文件夹名 —— 塞进 prompt 让模型优先复用，避免造出「技术/技术资料/技术收藏」
 * 这种同义新文件夹。这是这类功能好不好用的关键：分类的价值在于收敛，不在于新增。
 */
export async function fetchExistingFolders(roots: ChromeTreeNode[]): Promise<string[]> {
  return roots
    .flatMap((r) => r.children ?? [])
    .filter((c) => !c.url) // 只要文件夹
    .map((c) => c.title)
    .filter((t) => t.trim() !== '');
}

/**
 * 对一批书签求分组建议。
 *
 * @param cfg       端点/模型配置
 * @param apiKey    用户自己的 key
 * @param items     待归类的书签
 * @param existingFolders 现有文件夹名（可为空），用于引导复用
 */
export async function classifyBookmarks(
  cfg: AiConfig,
  apiKey: string,
  items: ClassifyItem[],
  existingFolders: string[] = [],
): Promise<ClassifyResult> {
  if (items.length === 0) return { groups: [], unclassified: [] };

  const batches = chunk(items, BATCH_SIZE);
  const settled = await mapLimit(batches, CONCURRENCY, (batch) =>
    classifyOneBatch(cfg, apiKey, batch, existingFolders).catch(() => null),
  );

  const groups: ClassifyGroup[] = [];
  const unclassified: string[] = [];
  let input = 0;
  let output = 0;
  let sawUsage = false;

  for (const [i, r] of settled.entries()) {
    const batch = batches[i];
    if (!r) {
      // 整批失败 → 该批全部记为未归类，不猜、不丢
      unclassified.push(...batch.map((b) => b.id));
      continue;
    }
    groups.push(...r.groups);
    unclassified.push(...r.unclassified);
    if (r.usage) {
      sawUsage = true;
      input += r.usage.input;
      output += r.usage.output;
    }
  }

  return { groups, unclassified, usage: sawUsage ? { input, output } : undefined };
}

async function classifyOneBatch(
  cfg: AiConfig,
  apiKey: string,
  batch: ClassifyItem[],
  existingFolders: string[],
): Promise<{
  groups: ClassifyGroup[];
  unclassified: string[];
  usage?: { input: number; output: number };
}> {
  const list = batch.map((b, i) => `${i}. ${truncate(b.title || b.url, TITLE_MAX)}`).join('\n');
  const reuse =
    existingFolders.length > 0
      ? `\n\nReuse these existing folder names when they fit (do not invent near-duplicates):\n${existingFolders
          .slice(0, 40)
          .join(', ')}`
      : '';

  const prompt =
    `Classify these ${batch.length} bookmarks into folders.\n\n${list}${reuse}\n\n` +
    `Rules:\n` +
    `- Use at most 8 folders. Fewer is better.\n` +
    `- Every bookmark must appear in exactly one folder.\n` +
    `- Use the numeric index, not the title.\n\n` +
    `Return JSON: {"groups":[{"folder":"name","ids":[0,3,7]}]}`;

  const res = await complete(cfg, apiKey, {
    messages: [{ role: 'user', content: prompt }],
    json: true,
    maxTokens: 1024,
    temperature: 0,
  });

  const raw = extractJson(res.text) as { groups?: unknown };
  const groups = normalizeGroups(raw?.groups, batch);
  const covered = new Set(groups.flatMap((g) => g.ids));
  return {
    groups,
    unclassified: batch.filter((b) => !covered.has(b.id)).map((b) => b.id),
    usage: res.usage,
  };
}

/**
 * 校验并归一化模型返回的分组。
 *
 * 小模型的输出不可全信，这里做四道过滤，宁可少收也不能把错误的 id 写进方案：
 *   1. groups 必须是数组，每项有字符串 folder；
 *   2. ids 必须是数字；
 *   3. 下标必须在该批范围内（防越界，防串批）；
 *   4. 归一化后去重（同一书签只归一次）。
 */
function normalizeGroups(raw: unknown, batch: ClassifyItem[]): ClassifyGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ClassifyGroup[] = [];

  for (const g of raw.slice(0, 12)) {
    if (!g || typeof g !== 'object') continue;
    const { folder, ids } = g as { folder?: unknown; ids?: unknown };
    if (typeof folder !== 'string' || !folder.trim()) continue;
    if (!Array.isArray(ids)) continue;

    const members: string[] = [];
    for (const i of ids) {
      if (typeof i !== 'number' || !Number.isInteger(i)) continue;
      if (i < 0 || i >= batch.length) continue; // 越界 → 丢弃
      const id = batch[i].id;
      if (seen.has(id)) continue; // 已在别的组 → 跳过
      seen.add(id);
      members.push(id);
    }
    if (members.length > 0) out.push({ folder: folder.trim(), ids: members });
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 并发上限固定的 map。失败的项由调用方处理（这里吞成 null，不中断整体）。 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const out: (R | null)[] = Array.from({ length: items.length }, () => null);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i]);
      } catch {
        out[i] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}
