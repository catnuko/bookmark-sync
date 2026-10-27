/**
 * src/lib/serialQueue.ts — 把异步任务串成一条队列，保证「同一时刻只有一份在跑」。
 *
 * ★ 为什么需要（2026-10-23 实测）：`runSync()` 原先没有任何并发保护，而一台新
 *   设备走完门禁会**连续触发多轮**同步（登录后 `syncNow()`、口令通过后
 *   `syncNow()`、首绑成功后 SW 内 `sync()`、事件桥 / alarm / 手动点击），彼此
 *   交叠。交叠的两轮各自操作同一份 coordinator 与 Chrome 书签树，直接导致：
 *     - 每个节点被投影 3 遍（重复书签）——`reverseApplyIntoChrome` 的事件抑制
 *       是单个布尔量，先结束的一轮把它置回 false，另一轮投影产生的 onCreated
 *       就被当成用户新建，再建一份 CRDT 节点；
 *     - 「空间刚建好却又要选一次」的假首绑门禁——`getBoundSpace()` 读到
 *       「空间=1 / 绑定=空」的中间态。
 *
 * 语义（刻意选择）：
 *   - **排队**，不是「忙就丢弃/直接返回」。调用方依赖返回值决定后续动作
 *     （首绑、口令门禁），丢掉一次调用会给出假结果。排队最坏只是多等一轮。
 *   - 队列**永不 reject**：任务抛错只影响它自己那次 Promise（交给调用方 catch），
 *     不能让一次失败把整条队列钉死在 rejected 状态。
 *   - 队列本身不设超时：各任务内部有自己的网络超时；卡死时重置模块状态即可
 *     （SW 里就是关掉 SW）。
 */
export interface SerialQueue {
  /** 排队执行 `task`；返回的 Promise 以 `task` 自身的成败结算。 */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** 当前排队 + 在跑的任务数（仅用于诊断/测试）。 */
  readonly size: number;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let size = 0;

  return {
    get size() {
      return size;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      size++;
      const done = (): void => {
        size--;
      };
      // 前一个任务无论成功失败都继续排下一个（`tail` 已被归一化成永不 reject）。
      const next = tail.then(task, task);
      tail = next.then(done, done);
      return next;
    },
  };
}
