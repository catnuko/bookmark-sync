// 测试/调试通道（P1 Firefox 跨浏览器 E2E 用）—— 白名单命令。
//
// Firefox 的 WebDriver 禁止导航到 moz-extension:// 页面（安全限制），无法像
// Chromium 那样用 CDP 直连 SW/popup。本通道让 e2e/test-bridge 扩展通过
// runtime.onMessageExternal 驱动本扩展执行受控操作：
//   sync / login / storage.* / bookmarks.*
//
// 安全边界：
// - 仅响应 sender.id === 'bsync-test-bridge@test.local'（测试桥扩展）
// - 仅白名单命令（与扩展自身能力等价的受控子集），无任意代码执行
// - 生产环境不会安装测试桥扩展，通道天然不可达
import { api, type ExtensionMessage } from './lib/ext.js';
import { supabase } from './lib/supabase.js';
import { runSync } from './sync.js';

const ALLOWED_SENDER = 'bsync-test-bridge@test.local';

interface TestChannelMessage extends ExtensionMessage {
  type: 'bsync-test';
  action?: string;
  payload?: Record<string, unknown>;
}

interface TestChannelResult {
  ok: boolean;
  [key: string]: unknown;
}

export function registerTestChannel(): void {
  const onMessageExternal = api.runtime.onMessageExternal;
  if (!onMessageExternal) return; // 非 Firefox 或旧浏览器：跳过
  onMessageExternal.addListener((msg, sender, sendResponse) => {
    const m = msg as TestChannelMessage;
    if (sender?.id !== ALLOWED_SENDER) return false; // 只信任测试桥
    if (m?.type !== 'bsync-test') return false;
    handle(m.action, m.payload ?? {}).then(sendResponse);
    return true; // 异步 sendResponse
  });
}

async function handle(
  action: string | undefined,
  payload: Record<string, unknown>,
): Promise<TestChannelResult> {
  try {
    switch (action) {
      case 'sync': {
        const r = await runSync();
        return {
          ok: r.ok,
          pushed: 'pushed' in r ? r.pushed : undefined,
          pulled: 'pulled' in r ? r.pulled : undefined,
          reason: 'reason' in r ? r.reason : undefined,
          error: 'error' in r ? r.error : undefined,
        };
      }
      case 'ping':
        return { ok: true };
      case 'login': {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: payload.email as string,
          password: payload.password as string,
        });
        return error ? { ok: false, error: error.message } : { ok: true, user: data?.user?.id };
      }
      case 'logout':
        await supabase.auth.signOut();
        return { ok: true };
      case 'storage.get': {
        const keys = Array.isArray(payload.keys) ? (payload.keys as string[]) : null;
        const res = await api.storage.local.get(keys ?? undefined);
        return { ok: true, data: res };
      }
      case 'storage.set':
        await api.storage.local.set((payload.values as Record<string, unknown> | undefined) ?? {});
        return { ok: true };
      case 'storage.remove':
        await api.storage.local.remove((payload.keys as string[] | undefined) ?? []);
        return { ok: true };
      case 'bookmarks.create': {
        const node = await api.bookmarks.create({
          parentId: payload.parentId as string,
          title: payload.title as string,
          ...(payload.url ? { url: payload.url as string } : {}),
        });
        return { ok: true, node };
      }
      case 'bookmarks.getTree':
        return { ok: true, tree: await api.bookmarks.getTree() };
      case 'bookmarks.removeTree':
        await api.bookmarks.removeTree(payload.id as string);
        return { ok: true };
      default:
        return { ok: false, error: `unknown action: ${action}` };
    }
  } catch (e) {
    const err = e as { message?: unknown } | undefined;
    return { ok: false, error: err?.message ?? String(e) };
  }
}
