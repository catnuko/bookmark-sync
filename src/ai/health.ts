/**
 * src/ai/health.ts — 健康洞察：本地统计 + AI 总结。
 *
 * ## 统计全在本地，只有「几个数字」离开本机
 *
 * 四张卡片（沉睡 / 重复 / 空文件夹 / 失效链接）各自的数据源都不出本机：
 *   - 重复：ai/dedupe.ts 的规范化判重（纯字符串）
 *   - 空文件夹：遍历书签树，子树里没有任何书签节点的文件夹
 *   - 沉睡：浏览历史（需 history 权限）里最后访问时间早于阈值的书签
 *   - 失效：**上一次链接体检的持久化摘要**（不在这里重跑探活）
 *
 * 送给模型的只有这些聚合数字（「4 条统计数据」），**没有一条书签标题或 URL**。
 * 这是本模块最重要的一条约束 —— 健康总结不需要看具体书签，就不该把书签发出去。
 *
 * ## 为什么「失效链接」读摘要而不是自己探活
 *
 * 探活是几分钟量级的串行网络任务（见 ai/linkCheck.ts），放在一个「打开就想看
 * 一眼」的统计页里显然不合适，而且会重复烧用户流量。所以链接体检跑完后把
 * 结果**摘要**落盘（本文件的 writeLinkSummary，由链接体检流程经
 * PaneLinkCheck.vue 调用），健康洞察读这份摘要。
 * 没跑过体检时该卡片显示「--」并引导去检测 —— 不猜、不编。
 *
 * ## 沉睡判定口径
 *
 * 「沉睡」= 浏览历史里查不到这条 URL，或最后访问时间早于 `now - sleepDays`。
 * 从未访问过的书签也算沉睡：用户收藏了却一次没打开，正是最该被提醒清理的一类。
 *
 * ## 依赖历史权限的降级
 *
 * 没授权时 `sleeping` 记为 `null`（不是 0）。0 会被误读成「没有沉睡书签」，
 * 而 null 让 UI 明确显示「-- / 需历史权限」。同理 `broken` 未检测时为 null。
 */

import { streamComplete, type AiConfig } from './provider.js';
import { collectBookmarks, findDuplicates, normalizeUrl } from './dedupe.js';
import { api } from '../lib/ext.js';
import type { ChromeTreeNode } from '../sync/index.js';

/** 浏览历史的最小 API 面（便于单测注入 fake）。 */
export interface HealthHistoryAPI {
  search(query: {
    text: string;
    startTime?: number;
    endTime?: number;
    maxResults?: number;
  }): Promise<Array<{ url?: string; lastVisitTime?: number }>>;
}

/** 四张统计卡片的数值。null 表示「这个口径当前取不到」，与 0 严格区分。 */
export interface HealthStats {
  /** 全部书签条数（含非 http(s)，用于「占比」类描述）。 */
  total: number;
  /** 直接挂在浏览器根级文件夹下的书签 —— 没被归进任何用户文件夹的「散书签」。 */
  loose: number;
  /** 精确重复的组数。 */
  duplicateGroups: number;
  /** 冗余条数（每组除保留项外的重复成员总数）。 */
  duplicateItems: number;
  /** 子树里不含任何书签的文件夹数。 */
  emptyFolders: number;
  /** 沉睡书签数。null = 未授权 history，取不到。 */
  sleeping: number | null;
  /** 上次体检判定的失效链接数。null = 还没跑过链接体检。 */
  broken: number | null;
  /** 上次体检判定的「跨域改版」链接数（域名迁移）。null = 未检测。 */
  changed: number | null;
}

/** 浏览器根下的固定容器 id：它们不是「用户的文件夹」，不参与空文件夹统计。 */
const FIXED_ROOT_IDS = new Set([
  '0',
  '1',
  '2',
  '3',
  'root________',
  'toolbar_____',
  'unfiled_____',
  'mobile______',
  'menu________',
]);

/** 默认沉睡阈值（天）。 */
export const DEFAULT_SLEEP_DAYS = 90;

/**
 * 沉睡查询在窗口内最多取回多少条访问记录。
 *
 * 只是防呆上限：窗口内的「最近访问」本身就有界，90 天里正常用户到不了这个量级。
 * 用它而不是 `maxResults: 0`，避免依赖「0 = 不限」这一在 Firefox 上文档含糊的语义。
 */
const RECENT_VISIT_LIMIT = 100_000;

/** 链接体检结果的持久化摘要（与 ai/linkCheck.ts 的 LinkCheckResult 汇总对应）。 */
export interface LinkSummary {
  /** 写入时间（ms）。 */
  at: number;
  /** 本轮探活总数。 */
  total: number;
  ok: number;
  broken: number;
  redirect: number;
  changed: number;
  unknown: number;
}

/** chrome.storage.local 里的键名。 */
export const LINK_SUMMARY_KEY = 'ai.linkSummary';

/** 读上次链接体检摘要。没跑过 / 解析失败都返回 null（UI 据此显示「未检测」）。 */
export async function readLinkSummary(): Promise<LinkSummary | null> {
  try {
    const raw = (await api.storage.local.get(LINK_SUMMARY_KEY))[LINK_SUMMARY_KEY];
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Partial<LinkSummary>;
    if (typeof s.total !== 'number' || typeof s.broken !== 'number') return null;
    return {
      at: typeof s.at === 'number' ? s.at : 0,
      total: s.total,
      ok: s.ok ?? 0,
      broken: s.broken,
      redirect: s.redirect ?? 0,
      changed: s.changed ?? 0,
      unknown: s.unknown ?? 0,
    };
  } catch {
    return null;
  }
}

/** 写链接体检摘要（由 PaneLinkCheck 在每轮探活结束后调用）。 */
export async function writeLinkSummary(s: LinkSummary): Promise<void> {
  try {
    await api.storage.local.set({ [LINK_SUMMARY_KEY]: s });
  } catch {
    /* 摘要写失败不影响体检本身，静默 */
  }
}

export interface CollectHealthOptions {
  /** 已授权时传 history API；未授权传 null → sleeping 记 null。 */
  history?: HealthHistoryAPI | null;
  /** 上次链接体检摘要（readLinkSummary() 的结果）；没跑过传 null。 */
  linkSummary?: LinkSummary | null;
  /** 沉睡阈值（天），默认 90。 */
  sleepDays?: number;
  /** 当前时间（ms），便于测试注入。默认 Date.now()。 */
  now?: number;
}

/**
 * 汇总健康统计（**只读、不发网络请求**）。
 *
 * 历史查询（history.search）是本函数唯一的异步网络/IO 调用，且只在传入 history 时执行。
 */
export async function collectHealth(
  roots: ChromeTreeNode[],
  opts: CollectHealthOptions = {},
): Promise<HealthStats> {
  const all = collectBookmarks(roots);

  // ---- 重复（纯本地规范化判重） ----
  const dupGroups = findDuplicates(roots);
  const duplicateItems = dupGroups.reduce((n, g) => n + g.dupIds.length, 0);

  // ---- 空文件夹 + 散书签 ----
  const scan = { emptyFolders: 0, loose: 0 };
  scanTree(roots, scan);

  // ---- 沉睡（需历史权限） ----
  let sleeping: number | null = null;
  if (opts.history) {
    sleeping = await countSleeping(opts.history, all, opts);
  }

  // ---- 失效（读上次体检摘要） ----
  const summary = opts.linkSummary ?? null;

  return {
    total: all.length,
    loose: scan.loose,
    duplicateGroups: dupGroups.length,
    duplicateItems,
    emptyFolders: scan.emptyFolders,
    sleeping,
    broken: summary ? summary.broken : null,
    changed: summary ? summary.changed : null,
  };
}

/**
 * 一次遍历同时算出「空文件夹」与「散书签」。
 *
 * - 空文件夹：文件夹的**子树**里没有任何书签节点。只有空子文件夹也算空。
 * - 散书签：父节点是浏览器根下的固定容器（书签栏 / 其他书签 / 移动端书签）——
 *   即「没被归进任何用户文件夹」的那些。这类正是「归类散书签」建议的目标。
 *
 * 返回值是「本子树是否含书签」，供上层判断自身是否为空。
 */
function scanTree(nodes: ChromeTreeNode[], out: { emptyFolders: number; loose: number }): boolean {
  let hasBookmark = false;
  for (const n of nodes) {
    if (n.url) {
      hasBookmark = true;
      if (n.parentId && FIXED_ROOT_IDS.has(n.parentId)) out.loose += 1;
      continue;
    }
    const childHas = scanTree(n.children ?? [], out);
    if (childHas) hasBookmark = true;
    else if (!FIXED_ROOT_IDS.has(n.id)) out.emptyFolders += 1;
  }
  return hasBookmark;
}

/**
 * 统计沉睡书签。
 *
 * ★ 用 `startTime: cutoff` 把查询**限定在阈值窗口内**，而不是「取全部历史再本地筛」。
 * 两个好处：
 *   1. 语义更干净：窗口内查不到的 URL，要么从没访问过、要么最后一次访问早于阈值 ——
 *      两种都是「沉睡」，一个集合判定就够了，不需要比时间戳。
 *   2. 不依赖 `maxResults: 0` 的跨浏览器语义（Chrome 视 0 为不限，Firefox 文档只写
 *      「默认 100」，含糊）。窗口内的访问量本来就有界，给一个大上限即可。
 *
 * 规范化用 dedupe.ts 的 normalizeUrl：`http://a.com/x?utm_source=…` 与书签里存的
 * 干净 URL 必须撞到同一个 key，否则会把访问过的书签误判成沉睡。
 */
async function countSleeping(
  history: HealthHistoryAPI,
  bookmarks: Array<{ id: string; url: string }>,
  opts: CollectHealthOptions,
): Promise<number> {
  const sleepDays = opts.sleepDays ?? DEFAULT_SLEEP_DAYS;
  const now = opts.now ?? Date.now();
  const cutoff = now - sleepDays * 24 * 60 * 60 * 1000;

  let items: Array<{ url?: string; lastVisitTime?: number }>;
  try {
    items = await history.search({ text: '', startTime: cutoff, maxResults: RECENT_VISIT_LIMIT });
  } catch {
    // 权限被撤销 / API 异常：返回 0 而非抛穿 —— 健康页不该因为历史读失败而整页报错。
    // 0 与「真的没有沉睡书签」在这里不可区分，属于可接受的降级（UI 仍显示卡片）。
    return 0;
  }

  const recent = new Set<string>();
  for (const it of items) {
    if (!it.url) continue;
    const key = normalizeUrl(it.url);
    if (key) recent.add(key);
  }

  let sleeping = 0;
  for (const b of bookmarks) {
    const key = normalizeUrl(b.url);
    if (!key || !recent.has(key)) sleeping += 1;
  }
  return sleeping;
}

// ---------------------------------------------------------------------------
// 整理建议
// ---------------------------------------------------------------------------

/** 一条整理建议。descKey 的占位符实参由 descSubs 提供，pane 用于跨页跳转。 */
export interface HealthSuggestion {
  icon: string;
  titleKey: string;
  descKey: string;
  descSubs: string[];
  actionKey: string;
  /** 目标 pane id（见 OptionsView.vue → panes）。 */
  pane: string;
}

/**
 * 由统计生成建议列表。
 *
 * 只给**确实有问题**的项（计数 > 0）—— 列一堆「0 条」的建议等于噪音。
 * 未取到的口径（null）同样不出建议：没跑过体检就催「去检测失效链接」是合理的，
 * 但那是引导而非「你有 N 条失效」，所以只保留一条「去检测」的入口。
 */
export function healthSuggestions(s: HealthStats): HealthSuggestion[] {
  const out: HealthSuggestion[] = [];
  if (s.loose > 0) {
    out.push({
      icon: 'folder-plus',
      titleKey: 'hlt_sugLooseTitle',
      descKey: 'hlt_sugLooseDesc',
      descSubs: [String(s.loose)],
      actionKey: 'hlt_sugLooseAction',
      pane: 'organize',
    });
  }
  if (s.duplicateItems > 0) {
    out.push({
      icon: 'copy',
      titleKey: 'hlt_sugDupTitle',
      descKey: 'hlt_sugDupDesc',
      descSubs: [String(s.duplicateGroups), String(s.duplicateItems)],
      actionKey: 'hlt_sugDupAction',
      pane: 'organize',
    });
  }
  if (s.broken !== null && s.broken > 0) {
    out.push({
      icon: 'globe',
      titleKey: 'hlt_sugBrokenTitle',
      descKey: 'hlt_sugBrokenDesc',
      descSubs: [String(s.broken)],
      actionKey: 'hlt_sugBrokenAction',
      pane: 'links',
    });
  } else if (s.broken === null) {
    // 没跑过体检：不是「有问题」而是「未知」，给一条引导去检测的入口。
    out.push({
      icon: 'globe',
      titleKey: 'hlt_sugCheckTitle',
      descKey: 'hlt_sugCheckDesc',
      descSubs: [],
      actionKey: 'hlt_sugCheckAction',
      pane: 'links',
    });
  }
  if (s.emptyFolders > 0) {
    out.push({
      icon: 'folder',
      titleKey: 'hlt_sugEmptyTitle',
      descKey: 'hlt_sugEmptyDesc',
      descSubs: [String(s.emptyFolders)],
      actionKey: 'hlt_sugEmptyAction',
      pane: 'organize',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI 总结
// ---------------------------------------------------------------------------

/** 健康总结的 system 指令。与归类/问答的 system 都不同，故单独一份。 */
export const HEALTH_SYSTEM_PROMPT =
  'You are a bookmark library advisor. You receive aggregate statistics about the ' +
  "user's bookmark collection — never the bookmarks themselves. " +
  'Write a short, concrete health summary (2-4 sentences) in the same language as the ' +
  'numbers suggest the user speaks. Point out what is healthy and what deserves attention, ' +
  'and give one or two prioritized suggestions. Do not invent numbers that are not given. ' +
  'If a metric is marked as unavailable, acknowledge it instead of guessing.';

/**
 * 拼出健康总结的用户消息。
 *
 * 只放聚合数字。`null` 的口径明确标注 unavailable，避免模型把它当成 0 来下结论。
 */
export function buildHealthPrompt(s: HealthStats): string {
  const line = (label: string, value: number | null, unit = '') =>
    `- ${label}: ${value === null ? 'unavailable (permission not granted or not checked)' : `${value}${unit}`}`;

  return (
    `Bookmark library statistics:\n` +
    `${line('total bookmarks', s.total)}\n` +
    `${line('bookmarks not filed into any folder', s.loose)}\n` +
    `${line('duplicate groups', s.duplicateGroups)}\n` +
    `${line('redundant duplicate items', s.duplicateItems)}\n` +
    `${line('empty folders', s.emptyFolders)}\n` +
    `${line('bookmarks dormant for 90+ days', s.sleeping)}\n` +
    `${line('broken links (404/410)', s.broken)}\n` +
    `${line('links moved to a new domain', s.changed)}\n\n` +
    `Write a brief health summary of this library and 1-2 prioritized suggestions. ` +
    `Use only these numbers.`
  );
}

/**
 * 流式生成健康总结。
 *
 * 与书签问答同款：自然语言、可能上百字，逐字输出是体验底线。调用方通过
 * `signal` 支持「停止生成」（abort 时 `for await` 抛 AbortError，据此区分
 * 「用户主动取消」与「真的失败」）。
 */
export async function* summarizeHealth(
  cfg: AiConfig,
  apiKey: string,
  stats: HealthStats,
  signal?: AbortSignal,
): AsyncGenerator<string, void, undefined> {
  yield* streamComplete(cfg, apiKey, {
    messages: [{ role: 'user', content: buildHealthPrompt(stats) }],
    system: HEALTH_SYSTEM_PROMPT,
    maxTokens: 400,
    temperature: 0.3,
    ...(signal ? { signal } : {}),
  });
}
