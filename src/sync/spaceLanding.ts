/**
 * 多空间落地（B2 多容器并存）—— 把「同步空间」映射到 chrome.bookmarks 里的
 * 一棵落地树。
 *
 * 背景：Chrome 只有一棵书签树（固定根 "1"/"2"/"3"），多个空间必须各自找一块
 * 互不重叠的落地区，否则两个空间会在同一棵原生树上互相吸走内容。
 *
 * 落地规则（全局一致，与设备无关）：
 *   - **默认空间**（`is_default`）：落地 = 本环境原生根。ROOT→"0"、书签栏→"1"、
 *     其他书签→"2"、移动设备书签→"3"、书签菜单→按需容器（Chromium）。
 *     之所以让默认空间继续占用原生根：地址栏星标默认存「书签栏」，主空间的
 *     落地必须是真书签栏，否则星标收藏的书签不进同步。这不是兼容老用户，
 *     而是主空间的产品语义。
 *   - **其它空间**：落地 = 书签栏下的容器文件夹「书签空间 · <空间名>」。
 *     容器 → ROOT_UUID；容器内的子文件夹（书签栏 / 其他书签 / 移动设备书签 /
 *     书签菜单）→ 对应固定根，**按需创建**：仅当该固定根在 CRDT 里有可见
 *     子节点时才建，空了就删——不用空间里不会出现空文件夹。
 *     用户直接丢进容器的书签会成为 ROOT_UUID 的子节点，留在容器顶层，
 *     照样参与同步。
 *
 * 注册表 `chrome.storage.local["crdt.spaceRoots"]`：
 *   { [spaceId]: { rootId, sub: { [fixedUuid]: chromeId } } }
 * 它既是「哪个 chromeId 是本空间落地区」的唯一事实，也是「哪些 chromeId 是
 * 别人家的落地区（foreign）」的来源——本空间的 capture / reverseApply 会整棵
 * 跳过 foreign，绝不碰别的空间的书签。
 *
 * 容器的生命周期：用户删掉容器 → 下次同步重建（书签从云端重新投影，不丢）；
 * 空间改名 → 同步容器标题；用户手动搬动容器 → 按注册表里的 chromeId 继续用，
 * 不看标题。
 */

import {
  BOOKMARKS_BAR_UUID,
  MOBILE_UUID,
  MENU_UUID,
  OTHER_BOOKMARKS_UUID,
  ROOT_UUID,
} from '../crdt/index.js';
import { barRootId, nativeRootPairs, type ChromeBookmarksAPI } from './chromeBridge.js';

/** 容器注册表在 chrome.storage.local 里的键。 */
export const SPACE_ROOTS_KEY = 'crdt.spaceRoots';

/** 一处落地区：rootId = 落地根 chromeId；sub = 固定根 uuid → chromeId。 */
export interface SpaceLandingRow {
  rootId: string;
  sub?: Record<string, string>;
}

export type SpaceRootsRegistry = Record<string, SpaceLandingRow>;

/** 固定根 UUID（容器空间里需要按需落地的全部根）。 */
export const FIXED_ROOT_UUIDS: readonly string[] = [
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
];

/** chrome.storage.local 的最小接口（便于测试注入）。 */
export interface LandingStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(obj: Record<string, unknown>): Promise<void>;
}

export interface SpaceLike {
  id: string;
  name?: string;
  is_default?: boolean;
}

export interface ResolveLandingDeps {
  chrome?: ChromeBookmarksAPI | null;
  storage: LandingStorage;
  /** 当前空间。 */
  space: SpaceLike;
  /** 账号下全部空间（用于计算 foreign 与清理已删空间的注册表行）。 */
  spaces: SpaceLike[];
  /** 已本地化的容器标题（调用方用 t() 生成，避免本模块依赖 i18n）。 */
  containerTitle: string;
  isFirefox: boolean;
}

export interface SpaceLanding {
  spaceId: string;
  /** native = 原生根落地（默认空间）；container = 容器落地。 */
  mode: 'native' | 'container';
  /** 落地根 chromeId。 */
  rootId: string;
  /** 本空间落地根的 [chromeId, uuid] 表（注入 IdBridge）。 */
  roots: Array<[string, string]>;
  /** 其它空间的落地根 chromeId：本空间整棵不碰。 */
  foreignRoots: string[];
}

/** 读取容器注册表（只读，不改）。 */
export async function loadSpaceRoots(
  storage: LandingStorage,
): Promise<SpaceRootsRegistry> {
  try {
    const res = await storage.get(SPACE_ROOTS_KEY);
    const reg = res?.[SPACE_ROOTS_KEY];
    return reg && typeof reg === 'object' ? (reg as SpaceRootsRegistry) : {};
  } catch {
    return {};
  }
}

/** 覆盖写入容器注册表。 */
export async function saveSpaceRoots(
  storage: LandingStorage,
  registry: SpaceRootsRegistry,
): Promise<void> {
  try {
    await storage.set({ [SPACE_ROOTS_KEY]: registry });
  } catch {
    /* storage 不可用时忽略：注册表可丢失重建（容器按标题/映射找回） */
  }
}

/** chromeId 是否指向一个真实存在的书签节点。 */
async function nodeExists(
  chrome: ChromeBookmarksAPI | null | undefined,
  id: string | null | undefined,
): Promise<boolean> {
  if (!chrome || !id) return false;
  try {
    const nodes = await chrome.get(id);
    return Array.isArray(nodes) && nodes.some((n) => n?.id === id);
  } catch {
    return false; // chrome.bookmarks.get 对不存在的 id 会 reject
  }
}

/** 容器标题（用户可见，改名后同步更新）。 */
export function containerTitleOf(deps: { containerTitle: string }): string {
  return deps.containerTitle;
}

/**
 * 解析（必要时创建）空间的落地区。
 *
 * 返回的 `roots` 直接注入 `IdBridge`；`foreignRoots` 列出其它空间的容器根，
 * 让本空间的 capture / reverseApply 整棵跳过别人的落地区。
 */
export async function resolveSpaceLanding(
  deps: ResolveLandingDeps,
): Promise<{ landing: SpaceLanding; registry: SpaceRootsRegistry }> {
  const { chrome, storage, space, spaces, containerTitle, isFirefox } = deps;
  const registry = await loadSpaceRoots(storage);

  // 已删空间的注册表行清理（空间删除后容器可能还被用户留着，不再归任何空间）。
  const liveIds = new Set(spaces.map((s) => s.id));
  let dirty = false;
  for (const sid of Object.keys(registry)) {
    if (!liveIds.has(sid)) {
      delete registry[sid];
      dirty = true;
    }
  }

  const isNative = !!space.is_default;

  if (isNative) {
    const pairs = nativeRootPairs(isFirefox);
    const rootId = pairs[0][0];
    // 默认空间**不登记注册表**：注册表是「容器注册表」，只描述非默认空间的落地区。
    // 曾把原生根登记进来，后果很严重——容器空间的 foreignRoots 会因此包含原生
    // 根（Chromium '0' / Firefox 'root________'），而容器本身正挂在原生根之下，
    // 于是容器内每个节点在 removeTrashedNodes 的祖先链判断里都成了「外来子树」，
    // 删除（墓碑）在容器空间彻底不生效。若历史版本留下过这一行，这里顺手清掉。
    if (registry[space.id]) {
      delete registry[space.id];
      dirty = true;
    }
    const foreignRoots = collectForeignRoots(registry, spaces, space.id, isFirefox);
    if (dirty) await saveSpaceRoots(storage, registry); // 只在真的改过注册表时落盘
    return {
      landing: {
        spaceId: space.id,
        mode: 'native',
        rootId,
        roots: pairs.map(([cid, uuid]) => [cid, uuid] as [string, string]),
        foreignRoots,
      },
      registry,
    };
  }

  // 容器空间：找回（或重建）容器。
  let row = registry[space.id];
  let rootId = row?.rootId ?? '';
  if (!(await nodeExists(chrome, rootId))) {
    rootId = '';
  }

  if (!rootId && chrome) {
    const parentId = barRootId(isFirefox);
    const parentOk = await nodeExists(chrome, parentId);
    if (parentOk) {
      try {
        const created = await chrome.create({ parentId, title: containerTitle });
        rootId = created.id;
      } catch (e) {
        console.warn(`[bsync] 创建空间容器失败: ${(e as Error)?.message ?? e}`);
      }
    }
  }

  // 校验子文件夹仍然存在（用户可能删了容器里的某个文件夹），顺带同步标题。
  const sub: Record<string, string> = {};
  const prevSub = row?.sub ?? {};
  for (const uuid of FIXED_ROOT_UUIDS) {
    const cid = prevSub[uuid];
    if (cid && (await nodeExists(chrome, cid))) sub[uuid] = cid;
  }

  if (rootId) {
    // 空间改名 → 容器标题跟随（只改既有容器，不新建）。
    await syncContainerTitle(chrome, rootId, space.name, containerTitle);
    if (row?.rootId !== rootId || !sameSub(sub, prevSub)) dirty = true;
    registry[space.id] = { rootId, sub };
  } else if (row) {
    delete registry[space.id];
    dirty = true;
  }

  const foreignRoots = collectForeignRoots(registry, spaces, space.id, isFirefox);
  if (dirty) await saveSpaceRoots(storage, registry);

  return {
    landing: {
      spaceId: space.id,
      mode: 'container',
      rootId,
      roots: rootId
        ? [
            [rootId, ROOT_UUID],
            ...Object.entries(sub).map(([uuid, cid]) => [cid, uuid] as [string, string]),
          ]
        : [],
      foreignRoots,
    },
    registry,
  };
}

/**
 * 把 bridge 当前的落地映射写回注册表（reverseApply 之后调用：固定根子文件夹
 * 是按需创建的，创建结果必须落盘，否则下次同步会把它们当陌生节点重新建）。
 */
export async function persistSpaceLanding(
  storage: LandingStorage,
  space: SpaceLike,
  registry: SpaceRootsRegistry,
  mapped: { rootId: string | null; sub: Record<string, string> },
): Promise<void> {
  if (space.is_default) return; // 默认空间落地是原生根，无需登记
  const next = { ...registry };
  if (!mapped.rootId) {
    delete next[space.id];
  } else {
    next[space.id] = { rootId: mapped.rootId, sub: { ...mapped.sub } };
  }
  await saveSpaceRoots(storage, next);
}

/**
 * 其它空间的容器根（本空间 must-not-touch 集合）。
 *
 * 两道过滤，缺一不可（这条不变式被踩过一次，见 resolveSpaceLanding 的注释）：
 *   1. **跳过默认空间**——它的落地区是原生根，而原生根是所有容器文件夹的祖先；
 *      一旦登记为 foreign，容器内全部节点都会被判成「外来子树」而永不删除。
 *   2. **按 id 再过滤一次**——即使注册表里被写入过原生根（脏数据 / 旧版本），
 *      也不让它变成 foreign。判断依据是本环境的原生根 id 表，比 is_default 更
 *      硬（不依赖调用方是否正确传了 is_default）。
 */
function collectForeignRoots(
  registry: SpaceRootsRegistry,
  spaces: SpaceLike[],
  selfId: string,
  isFirefox: boolean,
): string[] {
  const nativeIds = new Set(nativeRootPairs(isFirefox).map(([cid]) => cid));
  const out: string[] = [];
  for (const s of spaces) {
    if (s.id === selfId) continue;
    if (s.is_default) continue; // 默认空间落地 = 原生根
    const row = registry[s.id];
    if (row?.rootId && !nativeIds.has(row.rootId)) out.push(row.rootId);
  }
  return out;
}

function sameSub(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** 空间改名后把容器标题同步过去（标题只是给用户看的，识别只靠注册表）。 */
async function syncContainerTitle(
  chrome: ChromeBookmarksAPI | null | undefined,
  rootId: string,
  name: string | undefined,
  title: string,
): Promise<void> {
  if (!chrome || !name) return;
  try {
    const nodes = await chrome.get(rootId);
    const node = nodes?.[0];
    if (!node || node.title === title) return;
    await chrome.update(rootId, { title });
  } catch {
    /* 标题同步失败不影响同步语义 */
  }
}
