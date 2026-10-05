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
  const perms = (globalThis as { chrome?: { permissions?: ChromePermissions } }).chrome
    ?.permissions;
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
  const perms = (globalThis as { chrome?: { permissions?: ChromePermissions } }).chrome
    ?.permissions;
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
  const perms = (globalThis as { chrome?: { permissions?: ChromePermissions } }).chrome
    ?.permissions;
  if (!perms) return;
  try {
    await perms.remove({ origins: [`${origin}/*`] });
  } catch {
    /* 未持有该权限时 remove 会抛，忽略即可 */
  }
}

/** chrome.permissions 的最小结构类型（项目未装 @types/chrome，见 lib/ext.ts 说明）。 */
interface ChromePermissions {
  contains(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  request(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  remove(p: { origins?: string[]; permissions?: string[] }): Promise<void>;
}
