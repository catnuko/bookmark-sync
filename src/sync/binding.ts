/**
 * 设备 ↔ 空间的绑定决策（纯函数，供 sync.js 使用并独立测试）。
 *
 * 方案语义（「设备绑定空间」）：本机书签树 ≡ 绑定空间，一台设备只属于一个空间，
 * 不做本地热切换。所以「这台电脑加入哪个空间」是**一次性**的决定：
 *   - 写下去之前 = 首绑，可以在多个空间里选（`ask_user`）；
 *   - 写下去之后 = 只能换绑（清空本机 + 从目标空间重建），代价高得多。
 *
 * 因此这里的 `ask_user` 分支是**必须问**的：一旦在多个空间可选时擅自替用户绑定
 * 默认空间，「从未绑定过」这个事实就被抹掉，用户再也没机会选。
 */

export type FirstBindAction =
  /** 已绑定（或绑定空间还在）：照常同步。 */
  | 'already'
  /** 账号下一个空间都没有：自动创建默认空间并绑定（没得选）。 */
  | 'create_default'
  /** 只有一个空间：没得选，静默绑定（不弹窗打扰）。 */
  | 'auto_bind'
  /** 有多个空间：交回 UI 让用户选这台电脑加入哪个。 */
  | 'ask_user';

/**
 * 首绑决策。
 *
 * @param spaceCount 云端空间数
 * @param hasBoundSpace 本机是否已有有效绑定（`getBoundSpace().bound != null`）
 */
export function firstBindAction(spaceCount: number, hasBoundSpace: boolean): FirstBindAction {
  if (hasBoundSpace) return 'already';
  if (spaceCount <= 0) return 'create_default';
  if (spaceCount === 1) return 'auto_bind';
  return 'ask_user';
}

export type BindMode =
  /** 本机书签并入目标空间（不清空本机）。 */
  | 'merge'
  /** 清空本机书签，再由目标空间的 CRDT 重建。 */
  | 'overwrite';

/** 归一化绑定模式：任何非法值都退回 `merge`（不破坏本机数据的那个）。 */
export function normalizeBindMode(raw: unknown): BindMode {
  return raw === 'overwrite' ? 'overwrite' : 'merge';
}
