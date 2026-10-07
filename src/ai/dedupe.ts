/**
 * src/ai/dedupe.ts — 纯本地的重复书签检测。
 *
 * ## 为什么这一层不给模型
 *
 * 判重是**确定性**的：同一份书签树永远算出同一个答案。既然如此，交给模型就是
 * 白花钱、白外发隐私、还引入不确定性。所以这里零网络请求、零 token，纯字符串
 * 处理 —— 也正因如此，它可以放心地在几千条书签上全量跑。
 *
 * ## 规范化的取舍
 *
 * 只删**确定是追踪噪音**的参数（utm_*、fbclid、gclid、spm…），不碰语义参数。
 * `?id=123` 和 `?id=456` 砍掉 id 会把两篇不同的文章判成同一个 —— 那是制造
 * 假重复（用户点进去发现少了一篇书签，比不去重更糟）。所以判断标准是：
 * 「这个参数名是否只影响统计归因、不影响返回内容」。
 *
 * 另外会剥掉 AMP 路径（`/amp`、`/amp/`）与移动端 UA 变体前缀（`/m/`、`/mobile/`），
 * 它们在实践中确实指向同一篇文章。
 *
 * ## 永远不删节点
 *
 * 本模块**只报告、不删除**。去重的正确处理方式有三种：留最早的、留标题最全的、
 * 或者干脆让用户自己挑 —— 那是产品决策不是技术决策。本模块把选择权交回 UI，
 * 并且 UI 侧同样只能 `move` / `update`，不调 `removeTree`（一次误删会经
 * `onRemoved` → 墓碑上云，放大成跨设备数据丢失）。
 */

import type { ChromeTreeNode } from '../sync/index.js';

/** 一组重复书签：同一个规范化 URL 对应的全部节点。 */
export interface DuplicateGroup {
  /** 规范化后的 URL，组内所有成员都归到它。原始 URL 可能各不相同。 */
  key: string;
  /** 保留的成员（建议）：标题最完整、且若日期可知则最早。 */
  keepId: string;
  /** 建议移除的成员。UI 只标出来，由用户决定。 */
  dupIds: string[];
  /** 组内成员各自的原始 URL，供 UI 展示差异。 */
  urls: Record<string, string>;
}

/**
 * 只删追踪参数，不碰语义参数。
 *
 * 名单来自常见分析工具：Google Analytics / Facebook / 百度 / 微博 / 知乎等。
 * `utm_*` 用前缀规则覆盖全部变体（utm_source / utm_medium / utm_campaign …）。
 */
const TRACKING_PARAM_EXACT = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'spm',
  'scm',
  'from',
  'from_source',
  'ref',
  'referer',
  'referrer',
  'source',
  'share_source',
  'share_medium',
  'share_plat',
  'share_from',
  'share_token',
  'vd_source',
  'wfr',
  'for',
  'isappinstalled',
  'mkt_tok',
  'trk',
  'trkCampaign',
  'algo_pvid',
  'wxfrom',
  'weibo_id',
  'share_from_history',
]);

/**
 * AMP / 移动端路径变体：命中就剥掉再比较。
 *
 * 只处理**结尾**的这些后缀，且要求剥完路径非空 —— `/amp` 本身就是首页的站点
 * 不能剥成空路径。末尾的斜杠一并吃掉（`/post/amp/` 与 `/post/amp` 同义），
 * 否则 `+` 锚在 `$` 上会漏掉带尾斜杠的那一半。
 */
const PATH_VARIANT_RE = /(?:\/+(?:amp|mobile|m))+\/?$/i;

/** URL 是 http/https 才参与判重（扩展内部页、data: 等无意义）。 */
function isHttpUrl(url: string): boolean {
  return /^https?:$/i.test(protocolOf(url));
}

/** 取协议段（含冒号），非法 URL 返回空串。 */
function protocolOf(url: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.exec(url.trim())?.[0] ?? '';
}

/**
 * 把 URL 归一化成判重键。
 *
 * 步骤：协议+host 小写 → 去掉默认端口 → 剥 AMP 路径后缀 → 删追踪参数 →
 * 路径尾斜杠归一 → 按 key 排序 query（保证参数顺序不同的同一 URL 撞到同一组）。
 *
 * **fragment 默认保留**：多数站点的 `#section` 不改变内容，但有些站点（如
 * Medium、Notion 镜像）会按 hash 切换内容。保留 fragment = 宁可漏判也不误判。
 */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw.trim();

  // host 小写 + 去默认端口（`:80` / `:443`）
  u.hostname = u.hostname.toLowerCase();
  if (
    (u.protocol === 'http:' && u.port === '80') ||
    (u.protocol === 'https:' && u.port === '443')
  ) {
    u.port = '';
  }

  // AMP / 移动端路径变体（剥完不能为空路径）
  const stripped = u.pathname.replace(PATH_VARIANT_RE, '');
  if (stripped) u.pathname = stripped;

  // 删追踪参数。
  // 必须先快照 keys 再删：URLSearchParams.keys() 是**活迭代器**，边迭代边删会漏掉
  // 紧邻的下一个参数（删 a 后迭代器可能跳过 b）。oxc 的 no-useless-spread 在这里
  // 是误报 —— 这个 spread 是正确性要求，不是冗余。
  // eslint-disable-next-line unicorn/no-useless-spread
  for (const key of [...u.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAM_EXACT.has(lower)) {
      u.searchParams.delete(key);
    }
  }

  // 尾斜杠归一（`/a/` 与 `/a` 实践中通常是同一页；但根路径 `/` 必须保留）
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  // query 排序：同参数不同顺序撞到同一组
  u.searchParams.sort();

  return u.toString();
}

/** 树 → 全部书签（只要有 url 的节点），顺带记下所在文件夹路径供 UI 展示。 */
export function collectBookmarks(roots: ChromeTreeNode[]): Array<{
  id: string;
  title: string;
  url: string;
  path: string;
}> {
  const out: Array<{ id: string; title: string; url: string; path: string }> = [];

  const walk = (nodes: ChromeTreeNode[], trail: string[], depth: number) => {
    for (const n of nodes) {
      const title = (n.title ?? '').trim();
      if (n.url) {
        out.push({ id: n.id, title, url: n.url, path: trail.join(' / ') });
      } else if (n.children && depth < 6) {
        walk(n.children, [...trail, title].filter(Boolean), depth + 1);
      }
    }
  };

  walk(roots, [], 0);
  return out;
}

/**
 * 挑组内该保留哪一个。
 *
 * 优先级：标题非空 > 标题更长（信息量更大）> 原始 URL 更短（通常是干净版）
 * > id 字典序（保证确定性，避免同一份树两次跑出不同结果）。
 *
 * ★ 导出给 ai/semanticDedupe.ts 复用：精确重复与语义相似是**两套判定**，但
 * 「留哪一条」的规则必须同一份 —— 否则同一个组在两种视图里显示不同的保留项，
 * 用户会以为界面出错了。
 */
export function pickKeeper(members: Array<{ id: string; title: string; url: string }>): string {
  const sorted = [...members].sort((a, b) => {
    if (!a.title && b.title) return 1;
    if (a.title && !b.title) return -1;
    if (a.title.length !== b.title.length) return b.title.length - a.title.length;
    if (a.url.length !== b.url.length) return a.url.length - b.url.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0].id;
}

/**
 * 找出所有重复组。
 *
 * 只对 http(s) 的书签判重（`chrome://` / `data:` 等无意义）。规范化后按 key
 * 分组，组内 ≥2 才算重复。
 *
 * @param roots  待检查的子树（通常是用户选定文件夹的 children）
 * @param limit  返回的组数上限。超出的不返回而非截断成「还有 N 组」——
 *               截断会让用户误以为已经清干净了。
 */
export function findDuplicates(roots: ChromeTreeNode[], limit = 200): DuplicateGroup[] {
  const buckets = new Map<string, Array<{ id: string; title: string; url: string }>>();

  for (const b of collectBookmarks(roots)) {
    if (!isHttpUrl(b.url)) continue;
    const key = normalizeUrl(b.url);
    // normalizeUrl 对非法 URL 原样返回，原样返回的 key 仍可参与比对（同串即同页），
    // 但要排除空串（空 url 的节点不是书签）
    if (!key) continue;
    const arr = buckets.get(key);
    if (arr) arr.push({ id: b.id, title: b.title, url: b.url });
    else buckets.set(key, [{ id: b.id, title: b.title, url: b.url }]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const keepId = pickKeeper(members);
    const urls: Record<string, string> = {};
    for (const m of members) urls[m.id] = m.url;
    groups.push({
      key,
      keepId,
      dupIds: members.filter((m) => m.id !== keepId).map((m) => m.id),
      urls,
    });
  }

  // 重复条数多的排前面：用户先处理最脏的
  groups.sort((a, b) => b.dupIds.length - a.dupIds.length || (a.key < b.key ? -1 : 1));
  return groups.slice(0, limit);
}
