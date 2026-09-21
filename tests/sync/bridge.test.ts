/**
 * tests/sync/bridge.test.ts — chrome.bookmarks 事件 → coordinator 接线。
 *
 * Covers the integration that was previously unwired: local chrome events must
 * produce MoveOps with a consistent chromeId↔uuid mapping (the CRDT node id IS
 * the mapped uuid), enqueue for push, and trigger the onLocalOp flush hook.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemoryOpLogTransport,
  SyncCoordinator,
  captureLocalEvents,
  IdBridge,
  type ChromeBookmarksAPI,
  type ChromeTreeNode,
} from '../../src/sync/index.js';
import {
  generateKey,
  ROOT_NODE_ID,
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MENU_UUID,
  TRASH_NODE_ID,
} from '../../src/crdt/index.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-111111111111';

/** Minimal chrome.bookmarks mock with a manual event emitter. */
function makeChrome() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const api: ChromeBookmarksAPI = {
    getTree: async () => [],
    get: async () => [],
    create: async () => ({ id: 'x', title: '', parentId: '1' }),
    move: async () => ({ id: 'x', title: '', parentId: '1' }),
    update: async () => ({ id: 'x', title: '' }),
    remove: async () => {},
    removeTree: async () => {},
    getChildren: async () => [],
    onCreated: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.created ??= []).push(cb);
      },
    },
    onChanged: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.changed ??= []).push(cb);
      },
    },
    onMoved: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.moved ??= []).push(cb);
      },
    },
    onRemoved: {
      addListener: (cb: (...args: any[]) => void) => {
        (listeners.removed ??= []).push(cb);
      },
    },
  };
  const emit = (name: string, ...args: any[]) => {
    // event handlers are async; fire them in order and let promises settle later
    for (const cb of listeners[name] ?? []) void cb(...args);
  };
  return { api, emit };
}

let chrome: ReturnType<typeof makeChrome>;
let transport: MemoryOpLogTransport;
let coordinator: SyncCoordinator;
let sharedKey: CryptoKey;

beforeEach(async () => {
  chrome = makeChrome();
  transport = new MemoryOpLogTransport();
  sharedKey = await generateKey();
  coordinator = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-bridge',
    transport,
    key: sharedKey,
  });
});

describe('captureLocalEvents wiring', () => {
  it('onCreated maps chromeId→uuid and creates the CRDT node with THAT uuid', async () => {
    const bridge = new IdBridge();
    captureLocalEvents(chrome.api, coordinator, bridge);

    chrome.emit('created', 'b1', { id: 'b1', parentId: '1', title: 'foo', url: 'https://foo' });
    await new Promise((r) => setTimeout(r, 10));

    const uuid = bridge.toUuid('b1');
    expect(uuid).toBeTruthy();
    // The CRDT node must exist under the SAME uuid (previously a second random
    // uuid was created inside createNode, breaking the mapping).
    expect(coordinator.replica.getParent(uuid!)).toBe(BOOKMARKS_BAR_UUID);
    expect(coordinator.replica.getNodeMeta(uuid!)).toMatchObject({
      title: 'foo',
      url: 'https://foo',
    });

    // Op is queued for push and flushes to the transport.
    expect(await coordinator.flushPush()).toBe(1);
    expect(transport.size).toBe(1);
  });

  it('created→moved→changed→removed chain produces consistent ops', async () => {
    const bridge = new IdBridge();
    captureLocalEvents(chrome.api, coordinator, bridge);

    chrome.emit('created', 'b2', { id: 'b2', parentId: '1', title: 'x', url: 'https://x' });
    await new Promise((r) => setTimeout(r, 10));
    const uuid = bridge.toUuid('b2')!;

    // moved under "2" (other bookmarks)
    chrome.emit('moved', 'b2', { parentId: '2', oldParentId: '1', index: 0, oldIndex: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(coordinator.replica.getParent(uuid)).toBe(OTHER_BOOKMARKS_UUID);

    // title/url change
    chrome.emit('changed', 'b2', { title: 'y', url: 'https://y' });
    await new Promise((r) => setTimeout(r, 10));
    expect(coordinator.replica.getNodeMeta(uuid)).toMatchObject({ title: 'y', url: 'https://y' });

    // removed → tombstoned under TRASH
    chrome.emit('removed', 'b2', { removedNode: { id: 'b2', title: 'y' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(coordinator.replica.getParent(uuid)).toBe(TRASH_NODE_ID);

    // all 4 ops flush
    expect(await coordinator.flushPush()).toBe(4);
  });

  it('skips events while coordinator is not ready (lazy getter) and resumes after', async () => {
    const bridge = new IdBridge();
    let ready = false;
    const getC = () => (ready ? coordinator : null);
    captureLocalEvents(chrome.api, getC, bridge);

    chrome.emit('created', 'b3', { id: 'b3', parentId: '1', title: 'nope' });
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.toUuid('b3')).toBeNull(); // skipped entirely

    ready = true;
    chrome.emit('created', 'b3', { id: 'b3', parentId: '1', title: 'yes' });
    await new Promise((r) => setTimeout(r, 10));
    expect(bridge.toUuid('b3')).toBeTruthy();
    expect(await coordinator.flushPush()).toBe(1);
  });

  it('invokes onLocalOp after each applied local change', async () => {
    const bridge = new IdBridge();
    let flushes = 0;
    captureLocalEvents(chrome.api, coordinator, bridge, () => flushes++);

    chrome.emit('created', 'b4', { id: 'b4', parentId: '1', title: 'a' });
    chrome.emit('moved', 'b4', { parentId: '2', oldParentId: '1', index: 0, oldIndex: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(flushes).toBe(2);
  });

  it('suppressed flag blocks echo from reverse-apply', async () => {
    const bridge = new IdBridge();
    const { suppressed } = captureLocalEvents(chrome.api, coordinator, bridge);
    suppressed.value = true;
    chrome.emit('created', 'b5', { id: 'b5', parentId: '1', title: 'echo' });
    await new Promise((r) => setTimeout(r, 10));
    expect(await coordinator.flushPush()).toBe(0);
  });

  it('menu________ maps to MENU_UUID in forward; container create/change/move skipped, 删除容器 → 内容墓碑、菜单位置保留', async () => {
    const bridge = new IdBridge();
    // Firefox menu 根：forward 预置（跨环境全集）
    expect(bridge.toUuid('menu________')).toBe(MENU_UUID);
    // Chromium 端：MENU_UUID 无固定 chromeId（动态容器，backward 不预置）
    expect(bridge.toChromeId(MENU_UUID)).toBeNull();

    captureLocalEvents(chrome.api, coordinator, bridge);
    // 模拟 Chromium 端「书签菜单」动态容器：映射到 MENU_UUID 后，
    // create/change/move 不得产生 CRDT op（固定根语义，容器本身不建节点）。
    bridge.map('dyn-menu', MENU_UUID);
    chrome.emit('created', 'dyn-menu', { id: 'dyn-menu', parentId: '1', title: '书签菜单' });
    chrome.emit('changed', 'dyn-menu', { title: '改名了' });
    chrome.emit('moved', 'dyn-menu', { parentId: '1', oldParentId: '1', index: 2, oldIndex: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(await coordinator.flushPush()).toBe(0);
    // 固定根仍在 CRDT 树上
    expect(coordinator.replica.getParent(MENU_UUID)).toBe(ROOT_UUID);

    // 用户删除「书签菜单」容器（空容器、无内容）：菜单位置保留（MENU_UUID
    // 不 tombstone——它是 Firefox 原生根 menu________ 的映射，tombstone 会让
    // Firefox 菜单随同步报废），容器内无书签 → 不产生任何 op。
    chrome.emit('removed', 'dyn-menu', { removedNode: { id: 'dyn-menu', title: '书签菜单' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(coordinator.replica.getParent(MENU_UUID)).toBe(ROOT_UUID); // 位置仍在
    expect(await coordinator.flushPush()).toBe(0);

    // 菜单仍可达：Firefox 原生菜单（menu________）里手动放的书签正常入 CRDT 并同步
    chrome.emit('created', 'm1', {
      id: 'm1',
      parentId: 'menu________',
      title: '菜单书签',
      url: 'https://menu',
    });
    await new Promise((r) => setTimeout(r, 10));
    const mUuid = bridge.toUuid('m1');
    expect(mUuid).toBeTruthy();
    expect(coordinator.replica.getParent(mUuid!)).toBe(MENU_UUID);
    expect(await coordinator.flushPush()).toBe(1);
  });

  it('删除菜单容器 = 清空内容（墓碑子树），菜单位置保留', async () => {
    const bridge = new IdBridge();
    bridge.map('dyn-menu', MENU_UUID);
    captureLocalEvents(chrome.api, coordinator, bridge);
    // 菜单里有一个普通书签（父 = MENU_UUID）
    chrome.emit('created', 'm1', {
      id: 'm1',
      parentId: 'menu________',
      title: '百度百科',
      url: 'https://baike.baidu.com',
    });
    await new Promise((r) => setTimeout(r, 10));
    const mUuid = bridge.toUuid('m1')!;
    expect(coordinator.replica.getParent(mUuid)).toBe(MENU_UUID);
    await coordinator.flushPush();

    // 删除容器 → 只 tombstone 容器内书签（内容清空、跨设备一致），MENU_UUID 保留
    chrome.emit('removed', 'dyn-menu', {
      removedNode: {
        id: 'dyn-menu',
        title: '书签菜单',
        children: [
          { id: 'm1', parentId: 'dyn-menu', title: '百度百科', url: 'https://baike.baidu.com' },
        ],
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(coordinator.replica.getParent(MENU_UUID)).toBe(ROOT_UUID); // 位置保留
    expect(coordinator.replica.getParent(mUuid)).toBe(TRASH_NODE_ID); // 内容墓碑
    await coordinator.flushPush(); // 墓碑推送到 transport

    // 全量重放（另一设备视角）：菜单位置仍在、内容不复活
    const fresh = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: 'dev-fresh',
      transport,
      key: sharedKey,
    });
    await fresh.pull();
    expect(fresh.replica.getVisibleTree().some((e) => e.child === MENU_UUID)).toBe(true);
    expect(fresh.replica.getVisibleTree().some((e) => e.child === mUuid)).toBe(false);
  });

  it('suppressed 期间到达的删除事件入队，抑制结束后补处理（不丢失）', async () => {
    const bridge = new IdBridge();
    const guard = captureLocalEvents(chrome.api, coordinator, bridge);
    // 先创建一个普通书签并推送
    chrome.emit('created', 'b1', { id: 'b1', parentId: '1', title: 'x', url: 'https://x' });
    await new Promise((r) => setTimeout(r, 10));
    const bUuid = bridge.toUuid('b1')!;
    await coordinator.flushPush();

    // 模拟 reverseApply 运行（suppressed=true）：此时删除事件不得丢弃
    guard.suppressed.value = true;
    chrome.emit('removed', 'b1', { removedNode: { id: 'b1', title: 'x' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await coordinator.flushPush()).toBe(0); // 入队未处理

    // 抑制结束（reverseApply 完成）→ 补处理 → 墓碑产生并推送
    guard.suppressed.value = false;
    await new Promise((r) => setTimeout(r, 30));
    expect(coordinator.replica.getParent(bUuid)).toBe(TRASH_NODE_ID);
    expect(await coordinator.flushPush()).toBe(1);
  });

  it('IdBridge.load skips cross-environment fixed roots but keeps dynamic menu container', async () => {
    const bridge = new IdBridge();
    bridge.map('dyn-menu', MENU_UUID);
    bridge.map('999', '11111111-1111-4111-8111-111111111111');
    const snap = bridge.snapshot();

    const fresh = new IdBridge();
    fresh.load(snap);
    expect(fresh.toUuid('dyn-menu')).toBe(MENU_UUID);
    expect(fresh.toUuid('999')).toBe('11111111-1111-4111-8111-111111111111');
    expect(fresh.toUuid('menu________')).toBe(MENU_UUID); // forward 全集仍在
    expect(fresh.toChromeId(MENU_UUID)).toBe('dyn-menu'); // backward 不被跨环境根覆盖
  });

  // ---- 顺序（fractional position）接线：onCreated/onMoved 必须按 Chrome
  //     实际 index 生成 position，保证同步后兄弟顺序与用户排序一致 ----
  function sortedTitles(parentUuid: string): string[] {
    return coordinator.replica
      .getChildren(parentUuid)
      .sort((a, b) => {
        const pa = a.meta.position ?? '';
        const pb = b.meta.position ?? '';
        if (pa !== pb) return pa < pb ? -1 : 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .map((n) => n.meta.title as string);
  }

  it('onCreated writes increasing positions matching the Chrome index order', async () => {
    const bridge = new IdBridge();
    captureLocalEvents(chrome.api, coordinator, bridge);
    // Chrome 创建顺序 A,B,C（index 0,1,2）
    chrome.emit('created', 'a1', {
      id: 'a1',
      parentId: '1',
      title: 'AAA',
      url: 'https://a',
      index: 0,
    });
    chrome.emit('created', 'b1', {
      id: 'b1',
      parentId: '1',
      title: 'BBB',
      url: 'https://b',
      index: 1,
    });
    chrome.emit('created', 'c1', {
      id: 'c1',
      parentId: '1',
      title: 'CCC',
      url: 'https://c',
      index: 2,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(sortedTitles(BOOKMARKS_BAR_UUID)).toEqual(['AAA', 'BBB', 'CCC']);
    // position 严格递增
    const poses = coordinator.replica
      .getChildren(BOOKMARKS_BAR_UUID)
      .sort((a, b) => ((a.meta.position ?? '') < (b.meta.position ?? '') ? -1 : 1))
      .map((n) => n.meta.position);
    expect(poses.every((p, i) => i === 0 || poses[i - 1]! < p!)).toBe(true);
  });

  it('onMoved recomputes position so a drag-to-front wins locally', async () => {
    const bridge = new IdBridge();
    captureLocalEvents(chrome.api, coordinator, bridge);
    chrome.emit('created', 'a1', {
      id: 'a1',
      parentId: '1',
      title: 'AAA',
      url: 'https://a',
      index: 0,
    });
    chrome.emit('created', 'b1', {
      id: 'b1',
      parentId: '1',
      title: 'BBB',
      url: 'https://b',
      index: 1,
    });
    chrome.emit('created', 'c1', {
      id: 'c1',
      parentId: '1',
      title: 'CCC',
      url: 'https://c',
      index: 2,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(sortedTitles(BOOKMARKS_BAR_UUID)).toEqual(['AAA', 'BBB', 'CCC']);

    // 把 CCC 拖到最前（index 0）
    chrome.emit('moved', 'c1', { parentId: '1', oldParentId: '1', index: 0, oldIndex: 2 });
    await new Promise((r) => setTimeout(r, 20));
    expect(sortedTitles(BOOKMARKS_BAR_UUID)).toEqual(['CCC', 'AAA', 'BBB']);

    // 跨父移动：从书签栏移到其他书签（index 0）
    chrome.emit('moved', 'c1', { parentId: '2', oldParentId: '1', index: 0, oldIndex: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(coordinator.replica.getParent(bridge.toUuid('c1')!)).toBe(OTHER_BOOKMARKS_UUID);
    expect(sortedTitles(OTHER_BOOKMARKS_UUID)).toEqual(['CCC']);
  });

  it('two devices inserting at the same anchor converge to one order (position + uuid tie-break)', async () => {
    // 重建：同密钥 + 同一 op log（beforeEach 用随机 key，跨 coordinator 解密会失败）
    const key = await generateKey();
    transport = new MemoryOpLogTransport();
    coordinator = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-bridge', transport, key });
    const coord2 = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-2', transport, key });
    const b1 = new IdBridge();
    const b2 = new IdBridge();
    const ch2 = makeChrome();
    captureLocalEvents(chrome.api, coordinator, b1);
    captureLocalEvents(ch2.api, coord2, b2);

    // 设备 1：建 A（index 0）；设备 2：建 X（index 0）——同一锚点并发
    chrome.emit('created', 'a1', {
      id: 'a1',
      parentId: '1',
      title: 'A',
      url: 'https://a',
      index: 0,
    });
    await new Promise((r) => setTimeout(r, 10));
    ch2.emit('created', 'x1', { id: 'x1', parentId: '1', title: 'X', url: 'https://x', index: 0 });
    await new Promise((r) => setTimeout(r, 10));
    await Promise.all([coordinator.flushPush(), coord2.flushPush()]);

    // 各自从 op log 拉取并解密应用（同密钥），模拟双向同步收敛
    const c1 = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-1b', transport, key });
    const c2 = new SyncCoordinator({ spaceId: SPACE, deviceId: 'dev-2b', transport, key });
    await c1.pull();
    await c2.pull();

    const titles = (r: SyncCoordinator) =>
      r.replica
        .getChildren(BOOKMARKS_BAR_UUID)
        .sort((a, b) => {
          const pa = a.meta.position ?? '';
          const pb = b.meta.position ?? '';
          if (pa !== pb) return pa < pb ? -1 : 1;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        })
        .map((n) => n.meta.title as string);

    expect(titles(c1)).toEqual(titles(c2)); // 两端收敛到同一顺序
    expect(titles(c1).sort()).toEqual(['A', 'X']); // 且成员齐全
  });
});
