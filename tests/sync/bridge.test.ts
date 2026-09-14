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
  const listeners: Record<string, Array<(...args: never[]) => void>> = {};
  const api: ChromeBookmarksAPI = {
    getTree: async () => [],
    get: async () => [],
    create: async () => ({ id: 'x', title: '', parentId: '1' }),
    move: async () => ({ id: 'x', title: '', parentId: '1' }),
    update: async () => ({ id: 'x', title: '' }),
    remove: async () => {},
    removeTree: async () => {},
    getChildren: async () => [],
    onCreated: { addListener: (cb: (...args: never[]) => void) => { (listeners.created ??= []).push(cb); } },
    onChanged: { addListener: (cb: (...args: never[]) => void) => { (listeners.changed ??= []).push(cb); } },
    onMoved: { addListener: (cb: (...args: never[]) => void) => { (listeners.moved ??= []).push(cb); } },
    onRemoved: { addListener: (cb: (...args: never[]) => void) => { (listeners.removed ??= []).push(cb); } },
  };
  const emit = (name: string, ...args: never[]) => {
    // event handlers are async; fire them in order and let promises settle later
    for (const cb of listeners[name] ?? []) void cb(...args);
  };
  return { api, emit };
}

let chrome: ReturnType<typeof makeChrome>;
let transport: MemoryOpLogTransport;
let coordinator: SyncCoordinator;

beforeEach(async () => {
  chrome = makeChrome();
  transport = new MemoryOpLogTransport();
  coordinator = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-bridge',
    transport,
    key: await generateKey(),
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
    expect(coordinator.replica.getNodeMeta(uuid!)).toMatchObject({ title: 'foo', url: 'https://foo' });

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

  it('menu________ maps to MENU_UUID in forward; events on fixed-root containers are skipped', async () => {
    const bridge = new IdBridge();
    // Firefox menu 根：forward 预置（跨环境全集）
    expect(bridge.toUuid('menu________')).toBe(MENU_UUID);
    // Chromium 端：MENU_UUID 无固定 chromeId（动态容器，backward 不预置）
    expect(bridge.toChromeId(MENU_UUID)).toBeNull();

    captureLocalEvents(chrome.api, coordinator, bridge);
    // 模拟 Chromium 端「书签菜单」动态容器：映射到 MENU_UUID 后，
    // 其 create/change/move/remove 事件都不得产生 CRDT op（固定根语义）。
    bridge.map('dyn-menu', MENU_UUID);
    chrome.emit('created', 'dyn-menu', { id: 'dyn-menu', parentId: '1', title: '书签菜单' });
    chrome.emit('changed', 'dyn-menu', { title: '改名了' });
    chrome.emit('moved', 'dyn-menu', { parentId: '1', oldParentId: '1', index: 2, oldIndex: 0 });
    chrome.emit('removed', 'dyn-menu', { removedNode: { id: 'dyn-menu', title: '书签菜单' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(await coordinator.flushPush()).toBe(0);
    // 固定根未被 CRDT 删除（还在树上）
    expect(coordinator.replica.getParent(MENU_UUID)).toBe(ROOT_UUID);

    // 但 MENU_UUID 之下的普通书签（Firefox 菜单内容）正常入 CRDT
    chrome.emit('created', 'm1', { id: 'm1', parentId: 'menu________', title: '菜单书签', url: 'https://menu' });
    await new Promise((r) => setTimeout(r, 10));
    const mUuid = bridge.toUuid('m1');
    expect(mUuid).toBeTruthy();
    expect(coordinator.replica.getParent(mUuid!)).toBe(MENU_UUID);
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
});
