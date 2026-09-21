/**
 * 设备 ↔ 空间的绑定决策（纯函数，供 sync.js 使用并独立测试）。
 *
 * 方案语义（「设备绑定空间」）：本机书签树 ≡ 绑定空间，一台设备只属于一个空间，
 * 不做本地热切换。所以「这台电脑加入哪个空间」是**一次性**的决定：
 *   - 写下去之前 = 首绑，可能可以选（`ask_user`）；
 *   - 写下去之后 = 只能换绑（清空本机 + 从目标空间重建），代价高得多。
 *
 * 因此 `ask_user` 分支是**必须问**的：一旦在「有真选择」时擅自替用户绑定，
 * 「从未绑定过」这个事实就被抹掉，用户再也没机会选这台电脑加入哪个空间。
 *
 * 「有真选择」只有两种来源（`canCreateSpace` 见 `isPaidPlan`）：
 *   ① 云端有 ≥2 个空间 —— 加入哪个都说得通，替用户挑一个等于替他做主；
 *   ② 账号还能再建空间（付费档）—— 「给这台电脑单开一个空间」是合理诉求，
 *      而且这里是**唯一**能「新建 + 绑定」的时机：错过之后想单独开一个，得先
 *      新建空间再换绑，而换绑要清空本机书签。
 *
 * 两条都不成立（典型：免费档在新设备上，只有一个旧空间可加入）= 没得选，
 * 静默并入即可 —— 必选页面不该为「没得选」的人出现。
 */

export type FirstBindAction =
  /** 已绑定（或绑定空间还在）：照常同步。 */
  | 'already'
  /** 账号下一个空间都没有：自动创建默认空间并绑定（没得选，不打扰）。 */
  | 'create_default'
  /** 只有一个空间、且账号建不了新的：没得选，静默绑定（单空间用户不该被弹窗打扰）。 */
  | 'auto_bind'
  /** 有真选择（≥2 个空间，或还能新建）：交回 UI 让用户决定这台电脑加入哪个。 */
  | 'ask_user';

/**
 * 该计划是否「还能新建空间」（付费档）。
 *
 * 只判「是不是免费」，**不复刻** plan→空间上限的映射：那份映射唯一的家在服务端
 * `bsync_space_create`（迁移 0022：free 1 / plus·premium·basic 3 / 其余 10）。
 * 复制到前端迟早漂移成两套规则，而这里用错方向的代价不对称——多给一个会失败的
 * 「新建空间」选项（点下去由 `plan_locked` + 升级引导兜住），比前端自作主张少给
 * 一个本来能成功的选项要好。
 */
export function isPaidPlan(plan: unknown): boolean {
  return typeof plan === 'string' && plan !== '' && plan !== 'free';
}

/**
 * 首绑决策。
 *
 * @param spaceCount 云端空间数
 * @param hasBoundSpace 本机是否已有有效绑定（`getBoundSpace().bound != null`）
 * @param canCreateSpace 当前账号还能不能再建空间（`isPaidPlan(profile.plan)`）
 */
export function firstBindAction(
  spaceCount: number,
  hasBoundSpace: boolean,
  canCreateSpace: boolean,
): FirstBindAction {
  if (hasBoundSpace) return 'already';
  if (spaceCount <= 0) return 'create_default';
  if (spaceCount === 1 && !canCreateSpace) return 'auto_bind';
  return 'ask_user';
}

export type BindMode =
  /** 本机书签并入目标空间（不清空本机）。 */
  | 'merge'
  /** 清空本机书签，再由目标空间的 CRDT 重建。 */
  | 'overwrite';

/**
 * UI 是否该挡出首绑门禁（整页、不可关闭）。
 *
 * 直接复用 `firstBindAction` 的 `ask_user` 判据，保证「UI 挡住用户」与「同步侧
 * 拒绝自行绑定」两处永远同源——两边分头写条件，迟早会出现「界面放行了、同步却
 * 还在等选择」或者反过来的死锁。
 *
 * `boundStale`（绑定过、但该空间已被删）**不算**「从未绑定」：那条路径本机书签树
 * 是旧空间的投影，重选要走显式换绑（有清空/覆盖的明确提示），不该被当成新设备
 * 引流进门禁。
 */
export function bindGateNeeded(
  spaceCount: number,
  hasBoundSpace: boolean,
  boundStale: boolean,
  canCreateSpace: boolean,
): boolean {
  if (boundStale) return false;
  return firstBindAction(spaceCount, hasBoundSpace, canCreateSpace) === 'ask_user';
}

/** 归一化绑定模式：任何非法值都退回 `merge`（不破坏本机数据的那个）。 */
export function normalizeBindMode(raw: unknown): BindMode {
  return raw === 'overwrite' ? 'overwrite' : 'merge';
}

/** 本机绑定记录的存盘形态（`chrome.storage.local["boundSpaceId"]`）。 */
export interface StoredBinding {
  /** 写下这条绑定的账号 id。 */
  u?: string;
  /** 绑定的空间 id。 */
  s?: string;
}

export interface BindingResolution {
  /** 记录的归属账号（空串 = 无记录，或旧格式没记账号）。 */
  ownerId: string;
  /** 绑定的空间 id（空串 = 无绑定）。 */
  spaceId: string;
  /** 这条记录能否算作「当前账号在本机的绑定」。 */
  mine: boolean;
  /** 旧格式（裸字符串空间 id）——需要就地升级为带账号的格式。 */
  legacy: boolean;
}

const NO_BINDING: BindingResolution = { ownerId: '', spaceId: '', mine: false, legacy: false };

/**
 * 解析本机绑定记录。
 *
 * 绑定是「账号 × 设备」的事实，不是单纯的设备属性：同一台电脑换个账号登录，
 * 上一个账号的绑定**不能**继承下来。继承的后果不是少问一句，而是把本机书签树
 * 错误地并进别人（或自己的另一个）空间：
 *   - 那个空间在这个账号下查不到 → 误报「绑定空间已被删除」；
 *   - 万一 id 撞上 → 直接把本机书签写进不相干的空间。
 * 所以判据是「这条记录的归属账号 == 当前账号」，不是「记录存在」。
 *
 * 三种输入：
 *   - `{ u, s }`：当前格式；`u` 与当前账号不符即不算本机绑定。
 *   - 裸字符串（早期格式）：没记账号，按**本机记录**接受（`mine = true`），
 *     由调用方升级成当前格式；不能因为「没写账号」就把用户的绑定丢掉。
 *   - 其它（未设置 / 垃圾值）：从未绑定。
 */
export function parseBinding(stored: unknown, _ownerId: string): BindingResolution {
  if (typeof stored === 'string') {
    return stored ? { ownerId: '', spaceId: stored, mine: true, legacy: true } : NO_BINDING;
  }
  if (stored && typeof stored === 'object') {
    const rec = stored as StoredBinding;
    const ownerId = typeof rec.u === 'string' ? rec.u : '';
    const spaceId = typeof rec.s === 'string' ? rec.s : '';
    if (!spaceId) return NO_BINDING;
    // 没有归属账号的记录同样按本机记录接受（防御：半截 / 手工写入的记录）。
    return { ownerId, spaceId, mine: !ownerId || ownerId === _ownerId, legacy: false };
  }
  return NO_BINDING;
}
