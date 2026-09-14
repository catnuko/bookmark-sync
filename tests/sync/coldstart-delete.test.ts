/**
 * tests/sync/coldstart-delete.test.ts — 删除同步在 MV3 冷启动下的回归测试。
 *
 * 现象（用户报告）：
 *   1. 删除空白文件夹 → 点击「立即同步」→ 文件夹被拉回来；
 *   2. 添加能立即推送，删除不触发钩子。
 *
 * 根因（两层）：
 *   A. MV3 service worker 闲置终止后冷启动，_coordinator 直到 runSync 才创建；
 *      事件桥 getC() 返回 null → 删除事件被静默丢弃 → 墓碑从未产生/推送 →
 *      「立即同步」触发冷启动全量重放（服务端仍只有 create op）→ 文件夹复活。
 *   B. 即使事件不被丢弃（懒加载 coordinator），新 replica 的 Lamport 计数器
 *      从固定根（5）重新开始；首个本地 op 的 seq 会与旧 SW 实例已推送的
 *      (device, seq) 冲突 → bsync_op_push 的 ON CONFLICT DO NOTHING 静默丢弃
 *      → 墓碑依然到不了服务端。
 *
 * 修复后行为（本文件固化）：
 *   - 事件到达时 coordinator 未就绪 → 懒启动（active space + device + key +
 *     afterId/counter 恢复），不再丢弃；
 *   - coordinator 恢复持久化的设备计数器 → 新 op 的 seq 永不与已推送的冲突；
 *   - 删除后全量重放，墓碑仍胜出 → 文件夹不复活。
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
  TRASH_NODE_ID,
  BOOKMARKS_BAR_UUID,
} from '../../src/crdt/index.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-111111111111';
const DEVICE = 'dev-cold';

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
    for (const cb of listeners[name] ?? []) void cb(...args);
  };
  return { api, emit };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

let transport: MemoryOpLogTransport;
let chrome: ReturnType<typeof makeChrome>;

beforeEach(() => {
  transport = new MemoryOpLogTransport();
  chrome = makeChrome();
});

describe('删除事件 × SW 冷启动', () => {
  it('热启动：coordinator 就绪时删除产生墓碑并成功推送', async () => {
    const key = await generateKey();
    const warm = new SyncCoordinator({ spaceId: SPACE, deviceId: DEVICE, transport, key });
    const bridge = new IdBridge();
    captureLocalEvents(chrome.api, warm, bridge);

    // 用户创建空文件夹
    chrome.emit('created', 'f1', { id: 'f1', parentId: '1', title: '空文件夹', index: 0 });
    await tick();
    expect(await warm.flushPush()).toBe(1);
    const uuid = bridge.toUuid('f1')!;
    expect(warm.replica.getParent(uuid)).toBe(BOOKMARKS_BAR_UUID);

    // 用户删除文件夹 → 墓碑
    chrome.emit('removed', 'f1');
    await tick();
    expect(warm.replica.getParent(uuid)).toBe(TRASH_NODE_ID);
    expect(await warm.flushPush()).toBe(1);
    expect(transport.size).toBe(2); // create + tombstone
  });

  it('修复前现象：coordinator 未就绪时删除事件被丢弃 → 全量重放后文件夹复活', async () => {
    const key = await generateKey();

    // 第一阶段：热设备创建文件夹并推送（云端只有 create op）
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: DEVICE, transport, key });
    const bridgeA = new IdBridge();
    captureLocalEvents(chrome.api, A, bridgeA);
    chrome.emit('created', 'f1', { id: 'f1', parentId: '1', title: '空文件夹', index: 0 });
    await tick();
    expect(await A.flushPush()).toBe(1);
    const uuid = bridgeA.toUuid('f1')!;

    // 第二阶段：SW 冷启动，coordinator 未创建（getC() 返回 null）
    const cold = new SyncCoordinator({ spaceId: SPACE, deviceId: DEVICE, transport, key, afterId: 1 });
    const bridgeCold = new IdBridge();
    bridgeCold.load(bridgeA.snapshot());
    let ready = false;
    captureLocalEvents(chrome.api, () => (ready ? cold : null), bridgeCold);

    chrome.emit('removed', 'f1');
    await tick();
    expect(await cold.flushPush()).toBe(0); // 事件被丢弃，无墓碑

    // 第三阶段：点击「立即同步」→ 冷启动全量重放 → 文件夹复活
    ready = true;
    await cold.pullFrom(0);
    expect(cold.replica.getParent(uuid)).toBe(BOOKMARKS_BAR_UUID);
    expect(cold.replica.getVisibleTree().some((e) => e.child === uuid)).toBe(true);
  });

  it('修复后：事件懒启动 + 计数器恢复 → 删除墓碑不丢、全量重放不复活', async () => {
    const key = await generateKey();

    // 第一阶段：热设备创建文件夹并推送；模拟持久化 afterId=1、counter=6
    const A = new SyncCoordinator({ spaceId: SPACE, deviceId: DEVICE, transport, key });
    const bridgeA = new IdBridge();
    captureLocalEvents(chrome.api, A, bridgeA);
    chrome.emit('created', 'f1', { id: 'f1', parentId: '1', title: '空文件夹', index: 0 });
    await tick();
    expect(await A.flushPush()).toBe(1);
    const uuid = bridgeA.toUuid('f1')!;
    expect(A.replica.counter).toBe(6);

    // 第二阶段：SW 冷启动。修复后的 getCoordinator 从 storage 恢复 afterId=1、
    // counter=6 → 新 replica 计数器续 6，首个本地 op 的 seq=7（不与已推送的 6 冲突）。
    const cold = new SyncCoordinator({
      spaceId: SPACE,
      deviceId: DEVICE,
      transport,
      key,
      afterId: 1,
      initialCounter: 6,
    });
    const bridgeCold = new IdBridge();
    bridgeCold.load(bridgeA.snapshot());
    // 修复后的事件桥：getter 懒启动（此处直接返回已恢复的 coordinator）
    captureLocalEvents(chrome.api, () => cold, bridgeCold);

    chrome.emit('removed', 'f1');
    await tick();
    expect(cold.replica.getParent(uuid)).toBe(TRASH_NODE_ID);
    expect(await cold.flushPush()).toBe(1); // seq=7，不与 6 冲突 → 成功入库
    expect(transport.size).toBe(2);

    // 第三阶段：点击「立即同步」→ 冷启动全量重放 → 墓碑仍胜 → 不复活
    await cold.pullFrom(0);
    expect(cold.replica.getParent(uuid)).toBe(TRASH_NODE_ID);
    expect(cold.replica.getVisibleTree().some((e) => e.child === uuid)).toBe(false);
  });

  it('修复后：push 失败不清空 pendingPush，下轮重试不丢墓碑', async () => {
    const key = await generateKey();
    // 包装 transport：第一次 push 抛错，第二次成功
    const failing = new (class extends MemoryOpLogTransport {
      private failNext = true;
      override async push(spaceId: string, deviceId: string, ops: never[]) {
        if (this.failNext) {
          this.failNext = false;
          throw new Error('network down');
        }
        return super.push(spaceId, deviceId, ops);
      }
    })();
    const coord = new SyncCoordinator({ spaceId: SPACE, deviceId: DEVICE, transport: failing, key });
    const bridge = new IdBridge();
    captureLocalEvents(chrome.api, coord, bridge);
    chrome.emit('created', 'f1', { id: 'f1', parentId: '1', title: '空文件夹', index: 0 });
    chrome.emit('removed', 'f1');
    await tick();

    await expect(coord.flushPush()).rejects.toThrow('network down');
    expect(failing.size).toBe(0); // 未清空 → 下轮可重试

    expect(await coord.flushPush()).toBe(2); // create + tombstone 一起补推
    expect(failing.size).toBe(2);
  });
});
