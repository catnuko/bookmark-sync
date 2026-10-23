/**
 * tests/sync/serial-queue.test.ts — 同步串行队列（2026-10-23 新设备首次同步重复书签的根因）。
 *
 * 事故形状（e2e `two-device-sync` 实测）：
 *   全新 profile 的设备 B 走完门禁后，每个节点在本机出现 **3 份**
 *   （`folder | f1 | b1 | f2 | b2 | b2 | b2 | f2 | f2 | b1 | b1 | f1 | f1 | folder | folder`）。
 *
 * 根因：`runSync()` 原先没有任何并发保护，而新设备走完门禁会连续触发多轮同步
 * （登录后 `syncNow()`、口令通过后 `syncNow()`、首绑成功后 SW 内 `sync()`）。
 * 交叠的两轮同时投影同一棵树，而 `reverseApplyIntoChrome` 的事件抑制只是**单个
 * 布尔量** —— 先结束的一轮把它置回 false，另一轮投影产生的 onCreated 就被当成
 * 用户新建，再建一份 CRDT 节点。
 *
 * 本文件钉住队列语义（不测 runSync 本身，那需要真实网络）：
 *   1. 同一时刻只有一份在跑；
 *   2. 后到者**排队**而不是被丢弃（调用方依赖返回值）；
 *   3. 前一个任务抛错**不影响**后续任务（一次失败不能钉死整条队列）；
 *   4. 任务的返回值/异常原样交给它自己的调用方（不被队列吞掉）。
 */
import { describe, it, expect } from 'vitest';
import { createSerialQueue } from '../../src/lib/serialQueue.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('createSerialQueue', () => {
  it('同一时刻只有一份在跑（后到者排队等待前一个结束）', async () => {
    const q = createSerialQueue();
    const events: string[] = [];

    const a = q.run(async () => {
      events.push('a:start');
      await tick(30);
      events.push('a:end');
      return 'A';
    });
    const b = q.run(async () => {
      events.push('b:start');
      await tick(1);
      events.push('b:end');
      return 'B';
    });

    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
    // 关键断言：b 必须在 a 结束**之后**才开始（交叠即为 bug）
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('多个并发调用按提交顺序逐个执行', async () => {
    const q = createSerialQueue();
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4].map((n) =>
        q.run(async () => {
          order.push(n);
          await tick(5);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('前一个任务抛错不会阻断后续任务，也不改变队列顺序', async () => {
    const q = createSerialQueue();
    const events: string[] = [];

    const bad = q.run(async () => {
      events.push('bad:start');
      throw new Error('boom');
    });
    const good = q.run(async () => {
      events.push('good:start');
      return 'ok';
    });

    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBe('ok');
    expect(events).toEqual(['bad:start', 'good:start']);
  });

  it('连续多次失败后队列仍可用（不会钉死在 rejected 状态）', async () => {
    const q = createSerialQueue();
    for (let i = 0; i < 3; i++) {
      await expect(
        q.run(async () => {
          throw new Error(`fail-${i}`);
        }),
      ).rejects.toThrow(`fail-${i}`);
    }
    await expect(q.run(async () => 'alive')).resolves.toBe('alive');
  });

  it('任务返回值原样交给自己的调用方（不是队列的）', async () => {
    const q = createSerialQueue();
    const results = await Promise.all([
      q.run(async () => ({ ok: true, pushed: 11 })),
      q.run(async () => ({ ok: false, reason: 'bind_needed' })),
    ]);
    expect(results).toEqual([
      { ok: true, pushed: 11 },
      { ok: false, reason: 'bind_needed' },
    ]);
  });

  it('size 反映「在跑 + 排队中」的数量，全部结束后归零', async () => {
    const q = createSerialQueue();
    expect(q.size).toBe(0);
    const all = [1, 2, 3].map(() => q.run(() => tick(10)));
    expect(q.size).toBe(3);
    await Promise.all(all);
    expect(q.size).toBe(0);
  });
});
