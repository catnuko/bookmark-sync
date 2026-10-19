/**
 * tests/sync/itemLimit.test.ts — 免费档条数真限额（itemLimit）。
 *
 * 回归背景（2026-10-19）：免费档对外承诺 1,000 条，但旧实现里「超限」只是
 * 界面上把卡片标红，同步照推不误 —— 用户看到「已超出配额 · 请升级后继续同步」，
 * 实际书签还在正常上传，界面在说谎。
 *
 * 现在改成真限额：超限时 flushPush 只放行**删除类 op**（p === TRASH_NODE_ID），
 * 新增/移动留在队列。这里锁住三条判据：
 *   1) 超限 → 新增推不出去（服务端收不到）
 *   2) 超限 → 删除仍能推出去（否则用户删不掉、永远降不回限额内 = 死锁）
 *   3) 未超限 → 正常推送（限额不能误伤正常用户）
 */

import { describe, it, expect } from 'vitest';
import { MemoryOpLogTransport, SyncCoordinator } from '../../src/sync/index.js';
import { generateKey, ROOT_NODE_ID } from '../../src/crdt/index.js';

const SPACE = 'aaaaaaaa-0000-4000-8000-222222222222';

async function makeCoordinator(itemLimit?: number) {
  const transport = new MemoryOpLogTransport();
  const key = await generateKey();
  const c = new SyncCoordinator({
    spaceId: SPACE,
    deviceId: 'dev-limit',
    transport,
    key,
    itemLimit,
  });
  return { c, transport };
}

/** 往 ROOT_NODE_ID 下建 n 个带 url 的书签（= 会被计入 used_count 的节点）。 */
function seedBookmarks(c: SyncCoordinator, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(c.createNode(ROOT_NODE_ID, { title: `b${i}`, url: `https://example.com/${i}` }));
  }
  return ids;
}

describe('免费档条数限额（itemLimit）', () => {
  it('未达上限时正常推送', async () => {
    const { c, transport } = await makeCoordinator(1000);
    seedBookmarks(c, 5);

    expect(await c.flushPush()).toBe(5);
    expect(c.itemLimitBlocked).toBe(false);
    expect((await transport.pull(SPACE, 0)).rows.length).toBe(5);
  });

  it('超过上限时新增推不出去，且标记 itemLimitBlocked', async () => {
    const { c } = await makeCoordinator(3);
    seedBookmarks(c, 5); // 5 条 > 上限 3

    expect(await c.flushPush()).toBe(0);
    expect(c.itemLimitBlocked).toBe(true);
    // op 留在队列里，不丢——删到限额以内后还能推。
    expect(c.pendingPushCount).toBe(5);
  });

  it('★ 超过上限时删除仍能推出去（否则用户永远降不回限额内 = 死锁）', async () => {
    const { c, transport } = await makeCoordinator(3);
    const ids = seedBookmarks(c, 5);

    expect(await c.flushPush()).toBe(0); // 全被拦
    // 只删 1 条：可见数 5 → 4，仍 > 上限 3，所以这一轮仍处于「超限」态
    c.deleteNode(ids[0]);
    expect(c.pendingPushCount).toBe(6); // 5 条新增 + 1 条删除

    expect(await c.flushPush()).toBe(1); // 只放行删除
    expect(c.pendingPushCount).toBe(5);
    expect((await transport.pull(SPACE, 0)).rows.length).toBe(1);
  });

  it('删到限额以内后，下一轮 flushPush 放行剩余新增', async () => {
    const { c } = await makeCoordinator(3);
    const ids = seedBookmarks(c, 5);

    expect(await c.flushPush()).toBe(0);
    for (const id of ids) c.deleteNode(id); // 全删光 → 可见数 0 ≤ 上限
    expect(await c.flushPush()).toBe(5 + 5); // 5 删除 + 5 新增一起放行

    // 此时可见数已降为 0，不再受阻
    expect(c.itemLimitBlocked).toBe(false);
  });

  it('恰好等于上限时仍可新增（「1,000 条」的字面含义）', async () => {
    const { c } = await makeCoordinator(3);
    seedBookmarks(c, 3); // 正好 3 条

    expect(await c.flushPush()).toBe(3);
    expect(c.itemLimitBlocked).toBe(false);
  });

  it('itemLimit 为空 = 不限（付费档不受影响）', async () => {
    const { c, transport } = await makeCoordinator(undefined);
    seedBookmarks(c, 50);

    expect(await c.flushPush()).toBe(50);
    expect(c.itemLimitBlocked).toBe(false);
    expect((await transport.pull(SPACE, 0)).rows.length).toBe(50);
  });

  it('setItemLimit 可在生命周期内改档（升级后立即放行）', async () => {
    const { c } = await makeCoordinator(3);
    seedBookmarks(c, 5);

    expect(await c.flushPush()).toBe(0);
    expect(c.itemLimitBlocked).toBe(true);

    c.setItemLimit(undefined); // 用户升级到 Plus
    expect(await c.flushPush()).toBe(5);
    expect(c.itemLimitBlocked).toBe(false);
  });
});
