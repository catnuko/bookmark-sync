/**
 * src/lib/feedback.ts — 用户**主动**提交的反馈（问题 / 建议 / 其他）。
 *
 * 与 ./telemetry.ts 的区别（改这里前先读）：
 *   · telemetry 是**自动**上报错误元数据的旁路 —— 失败一律静默，绝不能变成新的
 *     失败面；
 *   · 本模块是**用户主动行为** —— 提交失败必须让用户看见，否则用户以为发出去了。
 *     所以这里**返回结构化结果**（而不是吞掉），由 UI 决定怎么提示。
 *
 * ⚠ 隐私边界（硬约束）：
 *   · `body` / `contactEmail` 是用户自由输入，我们不做内容过滤 —— 插件 UI 已提示
 *     「请勿粘贴书签、网址等敏感信息」，并在隐私政策中披露；
 *   · 自动附带的环境信息是**白名单**：app_version / platform / locale /
 *     last_error_phase，全部为枚举型标量。**绝不上报**书签内容、网址、文件夹名、
 *     口令或任何 E2EE 明文。
 *
 * 服务端对应物：`supabase/migrations/0045_feedback.sql`（bsync_submit_feedback）。
 */
import { supabase } from './supabase.js';
import { appVersion, platformTag, getLastErrorPhase } from './telemetry.js';
import { api } from './ext.js';

/** 对外客服邮箱（与官网 SITE.email / i18n contact.supportEmail 保持一致）。 */
export const SUPPORT_EMAIL = 'support@bookmark-sync.top';

/** 主仓库的 Issues 页（反馈入口；数据库侧 issue 同步同样指向主仓库，见迁移 0055）。 */
export const FEEDBACK_ISSUES_URL = 'https://github.com/catnuko/bookmark-sync/issues';

/** 反馈类型白名单 —— 与服务端 CHECK (kind in ('bug','idea','other')) 对齐。 */
export type FeedbackKind = 'bug' | 'idea' | 'other';

/** 提交失败的原因码（与服务端 `{ok:false,error}` 词表对齐，外加前端兜底的 network）。 */
export type FeedbackError =
  | 'unauthenticated'
  | 'empty'
  | 'invalid_email'
  | 'rate_limited'
  | 'network';

export interface FeedbackInput {
  kind: FeedbackKind;
  body: string;
  contactEmail?: string;
}

export type FeedbackResult = { ok: true } | { ok: false; error: FeedbackError };

/** 当前界面语言（'zh-CN' / 'en-US' …），取不到时留空。 */
function uiLanguage(): string {
  try {
    return globalThis.navigator?.language ?? '';
  } catch {
    return '';
  }
}

/**
 * 提交一条反馈。**不抛错** —— 所有异常归一为 `{ok:false,error:'network'}`，
 * 调用方只需按 `result.ok` 分支。
 *
 * 未登录时直接返回 `unauthenticated`（不白跑一次网络）；服务端也会再挡一层。
 */
export async function submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return { ok: false, error: 'unauthenticated' };

    const { data: res, error } = await supabase.rpc('bsync_submit_feedback', {
      p_kind: input.kind,
      p_body: input.body,
      p_contact_email: input.contactEmail ?? null,
      p_app_version: appVersion(),
      p_platform: platformTag(),
      p_locale: uiLanguage(),
      p_last_error_phase: getLastErrorPhase() || null,
    });

    if (error) return { ok: false, error: 'network' };

    const r = res as { ok?: boolean; error?: string } | null;
    if (r?.ok) return { ok: true };
    return { ok: false, error: (r?.error as FeedbackError) ?? 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

/**
 * 未登录用户的兜底：拼一个带版本/平台的 mailto 链接。
 *
 * 为什么要它：`src/App.vue` 是硬门禁 —— 未登录时整个插件只渲染登录页，帮助页根本
 * 到不了。而「登录不上」恰恰是最需要反馈的场景，所以在登录页直接给一条邮件通道。
 */
export function buildMailto(subject = 'Feedback', intro = ''): string {
  const subjectLine = `[${subject}] Bookmark Sync ${appVersion()} (${platformTag()})`;
  const signature = [
    '',
    '----',
    `version: ${appVersion()}`,
    `platform: ${platformTag()}`,
    `locale: ${uiLanguage() || 'unknown'}`,
  ].join('\n');
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subjectLine)}&body=${encodeURIComponent(`${intro}\n${signature}`)}`;
}

/** 在新标签打开反馈仓库的 Issues 页（弹窗随即失焦自动关闭）。 */
export function openFeedbackIssues(): void {
  if (api.tabs?.create) {
    api.tabs.create({ url: FEEDBACK_ISSUES_URL });
  } else {
    window.open(FEEDBACK_ISSUES_URL, '_blank');
  }
}
