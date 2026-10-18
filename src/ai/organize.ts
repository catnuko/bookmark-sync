/**
 * src/ai/organize.ts — 归类方案的生成、预览与落地。
 *
 * ## 三段式：选范围 → 出方案 → 落地
 *
 *   1. listFolders()   列出可选范围（落地根下的文件夹），用户挑一个
 *   2. planOrganize() 只读：调 classify 拿建议 + 复用/新建决策，算出 diff
 *   3. applyPlan()     写：按用户勾选的组执行 move / create
 *
 * 第 2 步和第 3 步之间隔着一次**用户显式确认** —— 模型返回的东西不自动生效。
 *
 * ## 硬约束：永不 removeTree
 *
 * 本模块只调 `chrome.bookmarks.move` 和 `chrome.bookmarks.create`，**不调 remove**。
 * 理由不是保守，是本项目已实测过的两条事故：
 *   - `removeTrashedNodes` 的全量真删（2026-10-04，所有书签消失）
 *   - 本机删除经 `onRemoved` → `pendingRemoved` 补调 → 墓碑 push 上云，
 *     把「本机丢数据」升级成「跨设备云端污染」（实测 3562 条 trash op）
 * AI 批量删除 = 把这两个风险乘上「模型可能判错」这个因子。改用户书签树时
 * **只做可逆的 move 与幂等的 create**：要删的东西交回用户自己点。
 *
 * ## 撤销靠快照
 *
 * chrome.bookmarks 没有 undo。所以 apply 之前把每个受影响节点的
 * `(id, parentId, index)` 记下来，撤销时逐个 move 回原位。
 * 局限要说清楚：撤销只能还原**本节点的位置**，不能还原「文件夹被删了」或
 * 「标题被改了」—— 所以本模块也不改标题、不删文件夹。
 *
 * ## 建文件夹只落在选定范围之内
 *
 * 新文件夹一律建在**用户选定的那个文件夹**下面，绝不建在浏览器根（`"0"` /
 * `root________`）下 —— 根节点不能增删条目，挂在根下的 CRDT 节点在别的设备
 * 投影时会报 "Can't modify the root bookmark folders."（2026-10-01 线上事故，
 * 1488 个节点不可达）。
 */

import type { AiConfig } from './provider.js';
import { classifyBookmarks, fetchExistingFolders, hostOf, type ClassifyGroup } from './classify.js';
import { collectBookmarks } from './dedupe.js';
import { resolveRoots } from '../sync/rootResolver.js';
import type { ChromeBookmarksAPI, ChromeTreeNode } from '../sync/index.js';

/** 只做本功能需要的最小 API 面，便于单测注入 fake。 */
export interface OrganizeBookmarksAPI {
  getTree(): Promise<ChromeTreeNode[]>;
  move(id: string, dest: { parentId: string; index?: number }): Promise<void>;
  create(props: { parentId: string; title: string }): Promise<{ id: string }>;
}

/** 范围候选：一个可选的文件夹。 */
export interface FolderChoice {
  id: string;
  title: string;
  /** 层级缩进用的深度（0 = 落地根的直接子文件夹）。 */
  depth: number;
  /** 该文件夹下**直接子书签**的条数 —— 0 说明它没有可归类的散书签。 */
  looseCount: number;
}

/** 一个建议组的落地形态。 */
export type PlanGroupKind = 'reuse' | 'create';

export interface PlanGroup {
  /** 稳定 id，供 UI 勾选与 v-for key。 */
  key: string;
  /** 模型给的文件夹名（create 时即新文件夹名）。 */
  folder: string;
  kind: PlanGroupKind;
  /** reuse 时的目标文件夹 chromeId；create 时为 undefined（落地时才知道）。 */
  targetId?: string;
  /** 本组要移动的节点。含标题供 UI 预览。 */
  items: Array<{ id: string; title: string; url: string }>;
}

/** 归类方案。落地前必须完整展示给用户看。 */
export interface OrganizePlan {
  /** 用户选定范围的文件夹 chromeId。 */
  scopeId: string;
  scopeTitle: string;
  /** 参与归类的散书签总数。 */
  total: number;
  groups: PlanGroup[];
  /** 未能归类的书签（模型没返回 / 批次失败 / 被取消）。 */
  unclassified: Array<{ id: string; title: string; url: string }>;
  /** 本方案的粗略 token 消耗，用于给用户一个成本预期。 */
  usage?: { input: number; output: number };
  /** 生成时被用户在批次边界取消（classify 半程中断）。已完成批次的方案保留。 */
  aborted?: boolean;
}

/** apply 前的位置快照，供撤销使用。 */
export interface ApplySnapshot {
  /** 每个被移动节点的原始位置。 */
  moved: Array<{ id: string; parentId: string; index: number }>;
  /** 本次创建的文件夹 id → 名称。撤销时**不删**它们（删会触发墓碑，见文件头）。 */
  createdFolders: Array<{ id: string; title: string }>;
}

/** apply 的结果。失败信息如实带回，不吞异常。 */
export interface ApplyResult {
  ok: boolean;
  snapshot: ApplySnapshot;
  movedCount: number;
  createdCount: number;
  /** 实际失败项（已成功的保留，不回滚 —— 半程状态比全失败更容易看懂）。 */
  failures: Array<{ id: string; message: string }>;
}

// 范围选择的深度上限：再深的文件夹对「整理散书签」没意义
const MAX_SCOPE_DEPTH = 3;

/**
 * 列出可作为归类范围的文件夹。
 *
 * 只列**落地根**下的文件夹（`resolveRoots` 的 pairs），不列浏览器根下的
 * 未识别子节点（受管书签、Firefox `tags________`）—— 那不是我们的拓扑，
 * 挂进去等于往 CRDT 里灌 `parent = ROOT_UUID` 的脏 op。
 *
 * ★ `pairs` 的第一项是**浏览器根本身**（`"0"` / `root________` → ROOT_UUID），
 * 它不是可整理的文件夹：必须跳过，否则(a)浏览器根下的固定根会被当成范围列出来，
 * (b)每个落地根都会被遍历两次（既作为 rootChromeId 的子、又作为自己的根）。
 *
 * `looseCount` 数的是**直接子书签**（不递归）：用户要整理的是「这个文件夹
 * 下面堆着的一堆链接」，而不是「这个文件夹的整棵子树」。
 */
export async function listFolders(chrome: OrganizeBookmarksAPI): Promise<FolderChoice[]> {
  const tree = await chrome.getTree();
  const { pairs, rootChromeId } = resolveRoots(tree, isFirefox());
  const out: FolderChoice[] = [];

  for (const [rootId] of pairs) {
    if (rootId === rootChromeId) continue; // 浏览器根不是范围
    const root = findNode(tree, rootId);
    if (!root?.children) continue;
    walk(root.children, 0, out);
  }

  return out.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
}

function walk(nodes: ChromeTreeNode[], depth: number, out: FolderChoice[]): void {
  if (depth > MAX_SCOPE_DEPTH) return;
  for (const n of nodes) {
    if (n.url) continue; // 书签不是文件夹
    const title = (n.title ?? '').trim();
    const loose = (n.children ?? []).filter((c) => !!c.url).length;
    if (title) out.push({ id: n.id, title, depth, looseCount: loose });
    if (n.children?.length) walk(n.children, depth + 1, out);
  }
}

function findNode(nodes: ChromeTreeNode[], id: string): ChromeTreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children ? findNode(n.children, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

function isFirefox(): boolean {
  return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
}

/**
 * 生成归类方案（**只读，不写任何东西**）。
 *
 * 流程：取选定文件夹的直接子书签 → 取该文件夹下已有的子文件夹名喂给模型让它复用
 * → classify 出分组 → 把分组映射成「复用现有文件夹 / 新建文件夹」。
 *
 * @param scopeId  用户选定的范围文件夹 chromeId
 * @param existingDepth 复用只在**选定范围的子层级**里找：把散书签归到
 *        「选定文件夹/子文件夹」和归到「选定文件夹/新建文件夹」对用户是同一件事，
 *        没必要去动范围外的结构。
 */
export async function planOrganize(
  chrome: OrganizeBookmarksAPI,
  cfg: AiConfig,
  apiKey: string,
  scopeId: string,
  signal?: AbortSignal,
): Promise<OrganizePlan> {
  const tree = await chrome.getTree();
  const scope = findNode(tree, scopeId);
  if (!scope) throw new Error(`scope folder not found: ${scopeId}`);
  if (scope.url) throw new Error('scope must be a folder, not a bookmark');

  // 只有直接子书签参与归类；已在一个子文件夹里的书签是「已整理过」的，不重复动
  const items = (scope.children ?? [])
    .filter((c) => !!c.url)
    .map((c) => ({ id: c.id, title: (c.title ?? '').trim(), url: c.url! }));

  if (items.length === 0) {
    return { scopeId, scopeTitle: scope.title, total: 0, groups: [], unclassified: [] };
  }

  // 复用候选：选定文件夹下的直接子文件夹（只拿文件夹，名字喂给模型）
  const childFolders = (scope.children ?? []).filter((c) => !c.url && (c.title ?? '').trim());
  const existingFolders = childFolders.map((f) => (f.title ?? '').trim());

  const res = await classifyBookmarks(cfg, apiKey, items, existingFolders, signal);
  const byId = new Map(items.map((i) => [i.id, i]));

  const groups: PlanGroup[] = res.groups
    .map((g, i) => {
      const reuse = childFolders.find((f) => (f.title ?? '').trim() === g.folder.trim());
      const kind: PlanGroupKind = reuse ? 'reuse' : 'create';
      return {
        key: `g${i}`,
        folder: g.folder.trim(),
        kind,
        ...(reuse ? { targetId: reuse.id } : {}),
        items: g.ids
          .map((id) => byId.get(id))
          .filter((x): x is { id: string; title: string; url: string } => !!x),
      };
    })
    .filter((g) => g.items.length > 0);

  return {
    scopeId,
    scopeTitle: scope.title,
    total: items.length,
    groups,
    unclassified: res.unclassified
      .map((id) => byId.get(id))
      .filter((x): x is { id: string; title: string; url: string } => !!x),
    ...(res.usage ? { usage: res.usage } : {}),
    ...(res.aborted ? { aborted: true } : {}),
  };
}

/** 一次落地会改动 200 条书签 —— 超过这个数就该让用户分批，而不是一口气搬。 */
const MAX_MOVES_PER_APPLY = 200;

/**
 * 落地：按勾选的组执行 create + move。
 *
 * ## 为什么逐个 move 而不批量
 *
 * chrome.bookmarks 没有任何批量接口。逐个 move 的另一个好处是**可以随时中断**：
 * 每步后检查 `onProgress` 回调是否要求中止，用户点「停止」就停在已完成的位置。
 *
 * ## 为什么先 create 全部文件夹再开始 move
 *
 * 若边建边移，中途失败会留下「搬了一半」的树（部分书签在新文件夹、部分还在原处）。
 * 先建齐文件夹再搬，失败时至少文件夹结构是完整的，用户重跑一次即可收敛。
 *
 * ## 事件抑制
 *
 * 本函数**不做**事件抑制（`_eventGuard.suppressed`）—— 那是同步引擎的机制，
 * 在这里动它会与在途的同步轮次打架。这里就是让 move 正常产生 CRDT op：
 * 这些移动是用户确认过的真实意图，**就该同步到其他设备**。
 */
export async function applyPlan(
  chrome: OrganizeBookmarksAPI,
  plan: OrganizePlan,
  selectedKeys: string[],
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): Promise<ApplyResult> {
  const chosen = plan.groups.filter((g) => selectedKeys.includes(g.key));
  const failures: ApplyResult['failures'] = [];
  const snapshot: ApplySnapshot = { moved: [], createdFolders: [] };

  const totalMoves = chosen.reduce((n, g) => n + g.items.length, 0);
  if (totalMoves > MAX_MOVES_PER_APPLY) {
    throw new Error(`too many moves in one apply: ${totalMoves} > ${MAX_MOVES_PER_APPLY}`);
  }

  // 索引快照必须在移动前取。index 缺失时退化为 0（追加到末尾）——
  // 移动本身仍然会写 position（由事件层的 computePosition 处理），
  // 这里的 index 只用于撤销时尽量还原原位。
  const nodeIndex = new Map<string, { parentId: string; index: number }>();
  const tree = await chrome.getTree();
  indexNodes(tree, nodeIndex);

  // ---- 第一阶段：建齐文件夹 ----
  //
  // ★ 不改传入的 plan 对象：新建文件夹的 id 只记在本地 Map 里。写回 plan 会让
  // 「同一份方案应用两次」第二次跳过建文件夹（targetId 已填），而 UI 恰恰会
  // 持有 plan 跨多次 apply（改勾选再应用）。targetId 不可信还可能让一次
  // create 失败的组被当成 reuse 组往不存在的 id 里 move。
  const targetIds = new Map<string, string>();
  for (const g of chosen) {
    if (shouldStop?.()) break;
    if (g.kind === 'reuse' && g.targetId) {
      targetIds.set(g.key, g.targetId); // 复用组无需建
      continue;
    }
    try {
      const created = await chrome.create({ parentId: plan.scopeId, title: g.folder });
      targetIds.set(g.key, created.id);
      snapshot.createdFolders.push({ id: created.id, title: g.folder });
    } catch (e) {
      failures.push({ id: g.key, message: describe(e) });
    }
  }

  // ---- 第二阶段：移动 ----
  let done = 0;
  for (const g of chosen) {
    if (shouldStop?.()) break;
    const targetId = targetIds.get(g.key);
    if (!targetId) continue; // 建文件夹失败的组：跳过，不猜
    for (const item of g.items) {
      if (shouldStop?.()) break;
      const prev = nodeIndex.get(item.id);
      if (prev) snapshot.moved.push({ id: item.id, ...prev });
      try {
        await chrome.move(item.id, { parentId: targetId });
        done += 1;
        onProgress?.(done, totalMoves);
      } catch (e) {
        failures.push({ id: item.id, message: describe(e) });
      }
    }
  }

  return {
    ok: failures.length === 0,
    snapshot,
    movedCount: done,
    createdCount: snapshot.createdFolders.length,
    failures,
  };
}

/**
 * 撤销 apply：把节点移回原位。
 *
 * ★ 不删新建的文件夹。删文件夹会走 `onRemoved` → 墓碑 → 上云，
 * 把「撤销」变成一次跨设备删除（见文件头）。空文件夹留在那儿，
 * 用户自己看一眼就能处理 —— 这是本项目两次事故换来的取舍。
 */
export async function revertApply(
  chrome: OrganizeBookmarksAPI,
  snapshot: ApplySnapshot,
): Promise<{ reverted: number; failed: Array<{ id: string; message: string }> }> {
  let reverted = 0;
  const failed: Array<{ id: string; message: string }> = [];
  // 逆序还原：先移回去的后移，避免中途被后续 move 顶掉索引
  for (const m of [...snapshot.moved].reverse()) {
    try {
      await chrome.move(m.id, { parentId: m.parentId, index: m.index });
      reverted += 1;
    } catch (e) {
      failed.push({ id: m.id, message: describe(e) });
    }
  }
  return { reverted, failed };
}

function indexNodes(
  nodes: ChromeTreeNode[],
  out: Map<string, { parentId: string; index: number }>,
): void {
  for (const n of nodes) {
    if (n.parentId) out.set(n.id, { parentId: n.parentId, index: n.index ?? 0 });
    if (n.children?.length) indexNodes(n.children, out);
  }
}

/** `String(e)` 对非 Error 抛出只会得到 "[object Object]"（本项目质量门硬规矩）。 */
function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? '[unserializable]';
  } catch {
    return '[unserializable]';
  }
}

/** 供 UI 复用的类型别名与工具，避免组件里重复 import 路径。 */
export type { ClassifyGroup };
export { collectBookmarks, hostOf };
