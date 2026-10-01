/**
 * src/lib/telemetry.ts — 同步错误的**最小**诊断上报。
 *
 * 为什么需要它：上架之后，唯一的故障信息来源是「用户投诉说同步失败」。
 * `describeError()` 已经把可读化铺到全部 `reason:'error'` 路径（见 ./errors.ts），
 * 但那串信息只落在**用户自己的** storage 与 UI 里 —— 我们看不到。于是每次排障
 * 都要先猜「他说的哪一步失败了」。
 *
 * 这个模块只回答一个问题：**哪个 phase 的哪类错误，在哪个版本上高频出现。**
 *
 * ⚠ 隐私边界（硬约束，改这里前先读）：
 *   1. **只上报元数据** —— phase / reason / error_name / error_message / error_stack /
 *      context / app_version / platform。**绝不上报**书签内容、网址、文件夹名、
 *      口令、任何 E2EE 明文。
 *   2. `context` 由调用方只填**枚举型标量**；本模块会丢掉非标量、超长值，
 *      并限制键数 —— 别把整个 state 或事件对象塞进来。
 *   3. 未登录不上报（服务端也会再挡一层：`auth.uid()` 为空直接 return）。
 *
 * ⚠ 上报是**旁路**，任何情况下都不许变成新的失败面：
 *   · 全部异常在这里吞掉，永不 reject；
 *   · 调用方一律写 `void reportError(...)`，不要 await 到同步主链路上；
 *   · 同一 phase 前端节流 30 秒（防错误风暴把请求打成雪崩），服务端还有一层
 *     按 (用户 × 指纹) 的限流与去重。
 *
 * 服务端对应物：`supabase/migrations/0042_error_reports.sql`。
 */
import { api } from './ext.js';
import { supabase } from './supabase.js';
import { describeError } from './errors.js';

declare const __BUILD_TIME__: string;

/** 上报开关的 storage 键（默认开；显式 false 才关闭）。选项页「高级」可切。 */
export const ERROR_REPORT_KEY = 'crdt.errorReport';

/** 同一 phase + reason 的前端节流窗口。与服务端限流是两层，不互相替代。 */
const MIN_INTERVAL_MS = 30_000;

/** context 白名单化后的上限（键数 / 键长 / 值长）。 */
const MAX_CTX_KEYS = 10;
const MAX_KEY_LEN = 24;
const MAX_VAL_LEN = 120;

let enabled = true;
const lastSentAt = new Map<string, number>();

/**
 * 最近一次被上报的错误 phase（仅内存，跨会话丢失）。
 * 用途：用户主动提交反馈时，把它当作排查上下文附带（见 ./feedback.ts）。
 * 只在 `enabled` 时记录 —— 用户关掉错误上报后，我们也不该继续留错误痕迹。
 */
let lastErrorPhase = '';

/** 最近一次错误上报的 phase；没有则返回空串。 */
export function getLastErrorPhase(): string {
  return lastErrorPhase;
}

/** 读开关。与 `loadAutoSync()` 同款：storage 里没有该键时视为开启。 */
export async function loadErrorReportPref(): Promise<void> {
  try {
    const s = await api.storage.local.get(ERROR_REPORT_KEY);
    enabled = s[ERROR_REPORT_KEY] !== false;
  } catch {
    enabled = true; // storage 读失败不改变默认值
  }
}

/** 供 store 的开关切换、以及 preview / 测试环境显式关闭。 */
export function setErrorReportEnabled(v: boolean): void {
  enabled = v;
}

export function isErrorReportEnabled(): boolean {
  return enabled;
}

/**
 * 上报一次错误。永不抛错、永不 reject —— 调用方不必 try/catch，
 * 但也不该 await 在关键路径上（用 `void reportError(...)`）。
 *
 * @param phase  出错阶段（'sync' / 'bind' / 'store' / 'crash' / 'rejection' 等，服务端截 40 字）
 * @param reason 机器可读的原因码（'error' / 'no_response' 等，与服务端 reason 词表一致）
 * @param error  原始抛出物（交给 describeError 还原成可读串）
 * @param context 少量枚举型标量；非标量会被丢弃
 */
export async function reportError(
  phase: string,
  reason: string,
  error: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    if (!enabled) return;

    // 记下最近出错的阶段（本地上下文，供用户提交反馈时附带）
    if (phase) lastErrorPhase = phase;

    // 前端节流：同一 phase + reason 30 秒内只发一次（错误风暴的第一道闸）。
    // ⚠ 键里必须带 reason：只按 phase 节流的话，`sync` 上一个高发的
    // quota_exceeded 会把同 30 秒内真正的崩溃挤掉，而那正是最该看到的信号。
    const now = Date.now();
    const key = `${phase}\u0001${reason}`;
    const last = lastSentAt.get(key) ?? 0;
    if (now - last < MIN_INTERVAL_MS) return;
    lastSentAt.set(key, now);

    // 未登录不上报：服务端也会挡，但没必要白跑一次网络
    const { data } = await supabase.auth.getSession();
    if (!data?.session) return;

    const e = error as { name?: unknown; stack?: unknown } | null | undefined;

    await supabase.rpc('bsync_error_report', {
      p_phase: phase,
      p_reason: reason,
      p_error_name: typeof e?.name === 'string' ? e.name : typeof error,
      p_error_message: describeError(error),
      p_error_stack: typeof e?.stack === 'string' ? e.stack : '',
      p_context: sanitizeContext(context),
      p_app_version: appVersion(),
      p_platform: platformTag(),
    });
  } catch {
    // 上报失败永远是静默的：它是旁路，不是功能
  }
}

/** 只留枚举型标量，丢掉对象 / 函数 / 超长值（防误传整个 state）。 */
function sanitizeContext(context?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!context) return out;
  let n = 0;
  for (const [k, v] of Object.entries(context)) {
    if (n >= MAX_CTX_KEYS) break;
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
    out[k.slice(0, MAX_KEY_LEN)] = String(v).slice(0, MAX_VAL_LEN);
    n++;
  }
  return out;
}

/** 扩展版本（manifest version）；取不到时回落构建时间。feedback.ts 复用它。 */
export function appVersion(): string {
  try {
    const v = api.runtime?.getManifest?.()?.version;
    if (typeof v === 'string' && v) return v;
  } catch {
    /* 非扩展环境（preview / 单测）没有 getManifest */
  }
  return typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown';
}

/** 压成 "Chrome 137" 这种短标签 —— 列宽只有 40，别塞完整 UA。feedback.ts 复用它。 */
export function platformTag(): string {
  try {
    const ua = globalThis.navigator?.userAgent ?? '';
    const m = /(Edg|Firefox|Chrome)\/(\d+)/.exec(ua);
    if (m) return `${m[1]} ${m[2]}`;
    if (ua) return 'other';
  } catch {
    /* ignore */
  }
  return 'unknown';
}
