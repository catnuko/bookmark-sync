/**
 * src/ai/hostAccess.ts — 运行时 host 权限申请（自建端点兜底）。
 *
 * ## 为什么默认不需要权限
 *
 * 主流服务商（Anthropic / OpenAI / DeepSeek / 智谱 / Ollama）都回 CORS 头，
 * 所以默认路径 **0 权限**：不写进 manifest、不申请、不弹任何窗口。
 *
 * ## 什么时候才需要
 *
 * 自建 / 中转 / 内网端点常常**不回** `Access-Control-Allow-Origin`，浏览器就挡了。
 * 这时唯一的办法是让扩展对该域有 host 权限（host 权限可绕过 CORS）。
 * 走 `optional_host_permissions` + `chrome.permissions.request()`，
 * 用户点了同意才生效，**不影响安装时的转化率**。
 *
 * ## 两个必须遵守的约束（踩过就是功能静默失效）
 *
 * 1. **必须在用户手势内调用**。`chrome.permissions.request()` 要求前台 UI 上下文
 *    （popup / options / content script）且手势未被消费。写成
 *    `await something(); await request()` 必然失败 —— 第一个 await 就把手势
 *    吃掉了。调用方须把它放在 click handler 的**第一句**。
 * 2. **manifest 必须先声明**。`optional_host_permissions` 里没写的域，
 *    request() 会直接被拒。
 *
 * 声明用 https 通配 + http 通配（而非 `<all_urls>`）：不覆盖 file:// 与
 * ftp:// 等无关协议，权限面小一点，审核时好解释。 */

import type { ExtensionPermissions } from '../lib/ext.js';

/** 与 public/manifest.json 的 optional_host_permissions 保持一致。 */
export const OPTIONAL_HOST_PATTERNS = ['https://*/*', 'http://*/*'] as const;

/** 从 baseUrl 取 origin。非法 URL 返回 null（不做猜测，交给调用方报错）。 */
export function originOf(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * 该 origin 是否已有 host 权限。
 *
 * 注意 `permissions.contains({origins})` 传的是**匹配模式**而不是裸 origin，
 * 所以要用 `origin + '/*'`；对 `https://a.com` 本身，`https://a.com/*` 才匹配。
 */
export async function hasHostAccess(origin: string): Promise<boolean> {
  const perms = permsApi();
  if (!perms) return false; // 非扩展环境（测试）→ 视为无权限，调用方走降级
  try {
    return await perms.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/**
 * 申请该 origin 的 host 权限。
 *
 * ⚠ **必须在用户手势内、且是 handler 的第一句**（见文件头约束 1）。
 *
 * @returns 用户是否同意。拒绝 / 抛错都视为不同意，调用方必须能降级。
 */
export async function requestHostAccess(origin: string): Promise<boolean> {
  const perms = permsApi();
  if (!perms) return false;
  try {
    return await perms.request({ origins: [`${origin}/*`] });
  } catch {
    // 手势已失效 / 非前台上下文 → 明确当作未获批，不抛穿到 UI
    return false;
  }
}

/** 撤销该 origin 的权限（设置页的「收回访问」用）。 */
export async function revokeHostAccess(origin: string): Promise<void> {
  const perms = permsApi();
  if (!perms) return;
  try {
    await perms.remove({ origins: [`${origin}/*`] });
  } catch {
    /* 未持有该权限时 remove 会抛，忽略即可 */
  }
}

/**
 * 本模块直连 `globalThis.chrome.permissions`（而不是 lib/ext.ts 的 `api`）：
 * 非扩展环境（单测）下 `api` 是 undefined，而这里的每个函数都要能安全降级。
 * 类型复用 lib/ext.ts 的那份，避免两处各写一遍。
 */
function permsApi(): ExtensionPermissions | undefined {
  return (globalThis as { chrome?: { permissions?: ExtensionPermissions } }).chrome?.permissions;
}

/**
 * 是否已获得**广域** host 权限（https + http 通配）。
 *
 * 与 `hasHostAccess(origin)` 的区别：那个查单个端点（自建 AI 网关用），这个查
 * 「能不能对任意站点发请求」。链接体检依赖后者 —— 没有广域权限时跨域 fetch 拿到的是
 * opaque 响应，**读不到 404**，探活等于白跑（见 ai/linkCheck.ts 文件头）。
 *
 * `contains` 传的是匹配模式数组，要求**全部**已授予才返回 true；manifest 里
 * `request()` 是一次性整批授予，所以按整批判断是准确的。
 */
export async function hasBroadHostAccess(): Promise<boolean> {
  const perms = permsApi();
  if (!perms) return false;
  try {
    return await perms.contains({ origins: [...OPTIONAL_HOST_PATTERNS] });
  } catch {
    return false;
  }
}

/**
 * 申请广域 host 权限。
 *
 * ⚠ 与 `requestHostAccess` 同一条约束：**必须在用户手势内、且是 handler 第一句**。
 */
export async function requestBroadHostAccess(): Promise<boolean> {
  const perms = permsApi();
  if (!perms) return false;
  try {
    return await perms.request({ origins: [...OPTIONAL_HOST_PATTERNS] });
  } catch {
    // 手势已失效 / 非前台上下文 / 用户拒绝 → 一律视为未获批
    return false;
  }
}
