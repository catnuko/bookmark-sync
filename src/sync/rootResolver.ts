/**
 * 运行时根解析：Chrome 双子树（2025-06 起）。
 *
 * 官方背景：<https://developer.chrome.com/blog/bookmarks-sync-changes>
 *
 * Chrome 把书签树拆成两棵平行子树 —— **syncing（账号）** 与
 * **non-syncing（本地）**。`getTree()` 的根节点下可能同时出现：
 *
 *   id=A folderType="bookmarks-bar" syncing=true    ← 账号书签栏
 *   id=B folderType="other"         syncing=true    ← 账号其他书签
 *   id=C folderType="bookmarks-bar" syncing=false   ← 本地书签栏
 *   id=D folderType="other"         syncing=false   ← 本地其他书签
 *
 * 官方**明确警告不要用 id / name 认根**（"`id` is not fixed"），必须按
 * `folderType` 认类型、`syncing` 认子树。旧实现把根写死成 "0"/"1"/"2"/"3"，
 * 于是账号子树被整棵跳过 —— 用户的账号书签静默不同步。
 *
 * 本模块把「根 chromeId → 固定根 UUID」的映射在每轮同步时解析出来喂给
 * IdBridge。账号根与本地根是**并列**的固定根（不是 alias），因此
 * chromeId ↔ uuid 仍是 1:1。
 *
 * 树形状随身份状态变化（FakeTag User Guide §6.1，
 * <https://genggoen.blogspot.com/2025/07/faketag-userguide-sync-vs-local.html>）：
 *   - 未登录            → 只有本地根
 *   - 已登录 + 本地为空 → 只有账号根（本地文件夹被隐藏）
 *   - 已登录 + 本地非空 → 两棵都在
 * 所以**每轮都要重新解析**，不能缓存成常量。
 */

import { ROOT_UUID, CHROME_ROOT_ID } from '../crdt/index.js';
import {
  fixedRootUuid,
  nativeRootPairs,
  // folderType 映射表与事件桥共用（放在 chromeBridge 避免循环 import）。
  LOCAL_ROOT_BY_FOLDER_TYPE as LOCAL_BY_FOLDER_TYPE,
  ACCOUNT_ROOT_BY_FOLDER_TYPE as ACCOUNT_BY_FOLDER_TYPE,
  type ChromeTreeNode,
} from './chromeBridge.js';

/** 解析结果：本环境实际的根集合。 */
export interface RootResolution {
  /** 浏览器根节点（Chrome "0" / Firefox `root________`）的 chromeId。 */
  rootChromeId: string;
  /** chromeId → 固定根 UUID（含账号根；不含浏览器根自身之外的普通节点）。 */
  pairs: Array<[string, string]>;
  /** 全部根 chromeId（守卫用）。 */
  rootIds: ReadonlySet<string>;
}

/**
 * 把一个根的直接子节点归类到固定根 UUID，认不出则返回 null。
 *
 * 有 `folderType`（Chrome 134+）→ 按 folderType + syncing 归类；
 * `folderType` 认识但不属于我们同步的三类（`'managed'` 受管书签等）→ 显式
 * 忽略，**不**退回静态 id 表（避免把受管书签误当固定根）。
 * 没有 `folderType`（Chrome < 134 / Firefox）→ 退回静态 id 表。
 */
function classifyRootChild(child: ChromeTreeNode): string | null {
  const ft = child.folderType;
  if (typeof ft === 'string') {
    const table = child.syncing ? ACCOUNT_BY_FOLDER_TYPE : LOCAL_BY_FOLDER_TYPE;
    return table[ft] ?? null;
  }
  const uuid = fixedRootUuid(child.id);
  // 静态表把浏览器根自身也映射成 ROOT_UUID，但子节点不可能是根
  return uuid === ROOT_UUID ? null : uuid;
}

/**
 * 解析本环境的根集合。
 *
 * `tree` 是 `chrome.bookmarks.getTree()` 的返回值（通常是 `[root]`）。
 * 取不到树（浏览器异常）时退回静态表，保持旧行为，避免把桥建成空的。
 */
export function resolveRoots(tree: ChromeTreeNode[], isFirefox: boolean): RootResolution {
  const rootNode = tree.find((n) => !n.parentId) ?? tree[0];

  if (!rootNode) {
    const fallback = nativeRootPairs(isFirefox);
    return {
      rootChromeId: fallback[0][0],
      pairs: fallback.map(([cid, uuid]) => [cid, uuid] as [string, string]),
      rootIds: new Set(fallback.map(([cid]) => cid)),
    };
  }

  const pairs: Array<[string, string]> = [[rootNode.id, ROOT_UUID]];
  const used = new Set<string>([ROOT_UUID]);
  for (const child of rootNode.children ?? []) {
    const uuid = classifyRootChild(child);
    // 同一 uuid 只认第一个（双子树下本地/账号各占一个 uuid，不会冲突；
    // 这里防的是浏览器返回重复节点这类异常形状）
    if (!uuid || used.has(uuid)) continue;
    used.add(uuid);
    pairs.push([child.id, uuid]);
  }

  return {
    rootChromeId: rootNode.id || (isFirefox ? 'root________' : CHROME_ROOT_ID),
    pairs,
    rootIds: new Set(pairs.map(([cid]) => cid)),
  };
}
