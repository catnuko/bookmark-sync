/**
 * src/lib/historyAccess.ts — 浏览历史（`history`）可选权限的申请与查询。
 *
 * ## 为什么历史权限是「可选」而不是默认申请
 *
 * 只有健康洞察里的「沉睡书签」需要读浏览历史。把 `history` 写进 manifest 的
 * `permissions` 会让**安装时**就弹「读取你的浏览记录」——那是一条劝退级别的权限，
 * 而绝大多数用户根本不用沉睡书签统计。所以走 `optional_permissions` + 运行时申请，
 * 用户点了同意才生效，**不影响安装转化**。
 *
 * ## 与 ai/hostAccess.ts 的分工
 *
 * hostAccess 管的是 `origins`（跨域 fetch），这里管的是 `permissions`（history）。
 * 两者共用同一份 `ExtensionPermissions` 类型，但申请对象不同，刻意分成两个模块 ——
 * 混在一起会让「哪一步在要什么权限」变得难以追踪。
 *
 * ## 同一条硬约束
 *
 * `requestHistoryAccess()` **必须在用户手势内、且是 handler 的第一句**调用
 * （与 hostAccess 完全一致）：`permissions.request()` 要求前台 UI 上下文且手势
 * 未被消费，前面任何一个 `await` 都会把手势吃掉，请求必然失败。
 */

import type { ExtensionPermissions } from './ext.js';

/** 该浏览器是否已授予 history 权限。 */
export async function hasHistoryAccess(): Promise<boolean> {
  const perms = permsApi();
  if (!perms) return false; // 非扩展环境（测试）→ 视为无权限，UI 走降级
  try {
    return await perms.contains({ permissions: ['history'] });
  } catch {
    return false;
  }
}

/**
 * 申请 history 权限。
 *
 * ⚠ **必须在用户手势内、且是 handler 第一句**（见文件头）。
 *
 * @returns 用户是否同意。拒绝 / 抛错都视为不同意，调用方必须能降级到「--」。
 */
export async function requestHistoryAccess(): Promise<boolean> {
  const perms = permsApi();
  if (!perms) return false;
  try {
    return await perms.request({ permissions: ['history'] });
  } catch {
    // 手势已失效 / 非前台上下文 → 明确当作未获批，不抛穿到 UI
    return false;
  }
}

/** 撤销 history 权限（设置页的「收回」用；目前仅由 UI 主动调用）。 */
export async function revokeHistoryAccess(): Promise<void> {
  const perms = permsApi();
  if (!perms) return;
  try {
    await perms.remove({ permissions: ['history'] });
  } catch {
    /* 未持有该权限时 remove 会抛，忽略即可 */
  }
}

/**
 * 直连 `globalThis.chrome.permissions`（而非 lib/ext.ts 的 `api`）：非扩展环境下
 * `api` 是 undefined，而这里的每个函数都要能安全降级。类型复用同一份。
 */
function permsApi(): ExtensionPermissions | undefined {
  return (globalThis as { chrome?: { permissions?: ExtensionPermissions } }).chrome?.permissions;
}
