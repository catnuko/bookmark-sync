/**
 * tests/sync/dupMechanism.test.ts — 「重复书签」机制 + Fix C 回归（2026-10-04 真机事故）。
 *
 * 真机症状（NEXT-TASK §8.8/§8.9）：Fix B 让 captureLocalTree 递归进回退文件夹子树后，
 * 一台 Chromium 设备把「账号书签栏」下 661 个存量书签按**新 uuid** 重建成重复节点。
 *
 * 收敛的机制假设：**replica 缺行**（`pullFrom` 解密失败 → `skipped++` → 水位越过、
 * 永不重拉 → `getVisibleTree()` 缺节点）时，capture 的内容索引里没有这些节点 →
 * 认领失败 → `randomUUID()` 新建 → 与云端既有节点**永久重复**。
 * 原 `replicaIncomplete` 只挡 GC，不挡 capture / onCreated。
 *
 * Fix C：replica 缺行时，`captureLocalTree` 与 `onCreated` 禁止盲建新节点——未认领的
 * 本地内容推迟到 replica 补齐后的下一轮同步再认领/新建。本文件把这两点固化为断言：
 *   - replicaIncomplete=true  → capture/onCreated 不新建（不重复）；
 *   - replicaIncomplete=false → 真新内容仍正常新建（正常路径不受影响）。
 */
import { describe, it, expect } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  captureLocalTree,
  captureLocalEvents,
  IdBridge,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_UUID,
  OTHER_BOOKMARKS_UUID,
  ACCOUNT_BOOKMARKS_BAR_UUID,
} from '../../src/crdt/index.js';

const SPACE = 'dddddddd-0000-4000-8000-555555555555';

function makeChrome(tree: ChromeTreeNode[]): ChromeBookmarksAPI & {
  fireCreated: (id: string, node: ChromeTreeNode) => Promise<void>;
} {
  const created: Array<(id: string, node: ChromeTreeNode) => void> = [];
  const api: ChromeBookmarksAPI = {
    getTree: async () => tree,
    get: async () => [],
    create: async () => ({ id: 'x', title: '', parentId: '1' }),
    move: async () => ({ id: 'x', title: '', parentId: '1' }),
    update: async () => ({ id: 'x', title: '' }),
    remove: async () => {},
    removeTree: async () => {},
    getChildren: async () => [],
    onCreated: { addListener: (l) => created.push(l) },
    onChanged: { addListener: () => {} },
    onMoved: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
  };
  return Object.assign(api, {
    fireCreated: async (id: string, node: ChromeTreeNode) => {
      for (const l of created) await l(id, node);
    },
  });
}

async function makeCoord(): Promise<SyncCoordinator> {
  return new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-dup',
    transport: new MemoryOpLogTransport(),
    key: await generateKey(),
  });
}

/** 把 coordinator 标记为「拉取时跳过了行」（模拟 decryptFailed 路径）。 */
function markIncomplete(coord: SyncCoordinator): void {
  // `replicaIncomplete` 是私有字段，运行时即普通属性；这里仅测试注入。
  (coord as unknown as { replicaIncomplete: boolean }).replicaIncomplete = true;
}

/** 本地树：root → 其他书签 → 回退文件夹 F（代表账号书签栏）→ 两个未映射书签。 */
function fallbackTree(): ChromeTreeNode[] {
  return [
    {
      id: '0',
      title: '',
      children: [
        { id: '2', title: '其他书签', parentId: '0', folderType: 'other', syncing: false },
        {
          id: 'F',
          title: '账号书签栏',
          parentId: '2',
          children: [
            { id: 'a1', title: '书签一', url: 'https://one', parentId: 'F' },
            { id: 'a2', title: '书签二', url: 'https://two', parentId: 'F' },
          ],
        },
      ],
    },
  ];
}

function makeBridge(): IdBridge {
  const bridge = new IdBridge(undefined, {
    roots: [
      ['0', ROOT_UUID],
      ['2', OTHER_BOOKMARKS_UUID],
    ],
  });
  bridge.markFallback(ACCOUNT_BOOKMARKS_BAR_UUID, 'F');
  bridge.map('F', ACCOUNT_BOOKMARKS_BAR_UUID);
  return bridge;
}

describe('Fix C 回归：replica 缺行时 capture/onCreated 不得盲建（防重复书签）', () => {
  it('captureLocalTree：replica 缺 a2 且 replicaIncomplete=true → 不新建、推迟', async () => {
    const coord = await makeCoord();
    // 云端「账号书签栏」下有 acc-a1 / acc-a2 两个节点……
    coord.createNodeWithId('acc-a1', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '书签一',
      url: 'https://one',
    });
    coord.createNodeWithId('acc-a2', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '书签二',
      url: 'https://two',
    });
    // ……但 replica 缺行（模拟解密失败被跳过）：把 acc-a2 从可见树里拿掉，并置位标志。
    coord.replica.deleteNode('acc-a2');
    markIncomplete(coord);

    const bridge = makeBridge();
    const chrome = makeChrome(fallbackTree());
    const captured = await captureLocalTree(chrome, coord, bridge);

    // a1 认领仍正常（索引里有 acc-a1）；a2 缺行 + 标志置位 → 推迟，不新建。
    expect(bridge.toUuid('a1')).toBe('acc-a1');
    expect(bridge.toUuid('a2')).toBeNull(); // 未映射、未新建
    expect(captured).toBe(0); // ← Fix C：不造重复
  });

  it('captureLocalTree：replica 完整 + 真新内容 → 仍正常新建（Fix C 不误伤）', async () => {
    const coord = await makeCoord(); // 云端/replica 都没有本地 a1/a2（真新）
    const bridge = makeBridge();
    const chrome = makeChrome(fallbackTree());
    const captured = await captureLocalTree(chrome, coord, bridge);

    expect(bridge.toUuid('a1')).not.toBeNull();
    expect(bridge.toUuid('a2')).not.toBeNull();
    expect(captured).toBe(2); // 两个都是真新 → 正常新建
  });

  it('onCreated：replicaIncomplete=true 且内容已存在 → 推迟、不盲建重复', async () => {
    const coord = await makeCoord();
    coord.createNodeWithId('acc-a1', ACCOUNT_BOOKMARKS_BAR_UUID, {
      title: '书签一',
      url: 'https://one',
    });
    markIncomplete(coord);
    const bridge = makeBridge();
    const chrome = makeChrome(fallbackTree());
    captureLocalEvents(chrome, coord, bridge, undefined);
    // Chrome 为已存在的 a1 补发一个 onCreated（映射丢失场景）。
    await chrome.fireCreated('a1', {
      id: 'a1',
      title: '书签一',
      url: 'https://one',
      parentId: 'F',
    });

    expect(bridge.toUuid('a1')).toBeNull(); // ← Fix C：推迟，未新建重复
  });

  it('onCreated：replica 完整 + 真新书签 → 仍正常新建（Fix C 不误伤）', async () => {
    const coord = await makeCoord();
    const bridge = makeBridge();
    const chrome = makeChrome(fallbackTree());
    captureLocalEvents(chrome, coord, bridge, undefined);
    await chrome.fireCreated('a1', {
      id: 'a1',
      title: '书签一',
      url: 'https://one',
      parentId: 'F',
    });

    expect(bridge.toUuid('a1')).not.toBeNull();
  });
});
