/**
 * src/ai/provider.ts — BYOK LLM 客户端（用户自带 API Key）。
 *
 * ## 为什么是 BYOK 而不是服务端代理
 *
 * 本项目是**操作级 E2EE**：整个 MoveOp（含 title / url）连同父节点、子节点、
 * 时间戳一起被 AES-256-GCM 加密后才上行（见 sync/opCrypto.ts）。服务端只存
 * `{iv, ciphertext}`，连「有多少条书签」都数不出来（见迁移 0032 的说明：字节是
 * 唯一可服务端执行的口径）。这意味着**服务端拿不到明文，任何服务端 AI 都得先把
 * 密钥传上去**——那会让官网「端到端加密」的承诺当场作废。
 *
 * 所以这里的设计是：明文只在本机存在，Key 也只存在本机（chrome.storage.local），
 * 请求由扩展直接发往用户自己指定的端点。服务端始终看不到明文，E2EE 不变。
 *
 * ## CORS 与 host_permissions
 *
 * 主流服务商（Anthropic / OpenAI / DeepSeek / 智谱 / Ollama …）都开了 CORS，
 * 所以**默认不需要任何 host 权限**。Anthropic 需要额外带一个请求头
 * `anthropic-dangerous-direct-browser-access: true` 才会放开跨域（该 header 的
 * 名字就是在警告「浏览器里放 key 有风险」——BYOK 场景下用户明知风险并主动填入，
 * 属于官方明确认可的用法）。
 *
 * 自建 / 中转端点若不回 CORS 头，才需要用户授权 host 权限：见 ensureHostAccess()，
 * 它走 optional_host_permissions + 运行时申请，且**必须在用户手势内调用**。
 *
 * ## 两种调用方式
 *
 * - `complete()`  一次性返回。**归类（classify.ts）用这个** —— 输出是几十字的 JSON，
 *   流式没有收益，而且 `extractJson` 需要完整文本才能解析。
 * - `streamComplete()` 逐块产出文本。**书签问答用这个** —— 回答是自然语言，可能几百字，
 *   等全量返回要几秒；逐字输出是这类交互的体验底线。
 *
 * 两者共用同一套 headers / 错误解析 / CORS 判定，差异只在请求体的 `stream` 标志与
 * 响应解析（JSON 对象 vs SSE 行流）。
 *
 * ## 不做的事
 *
 * - 不做任何重试 / 退避：AI 是用户主动触发的，失败就如实报错，重试只会掩盖问题。
 * - 不打任何遥测：明文和 key 都不出本机，没什么可统计的。
 */

/** 支持的服务商。`wire` 决定请求体与响应解析的形状。 */
export type AiProvider = 'anthropic' | 'openai' | 'deepseek' | 'custom';

export interface AiConfig {
  provider: AiProvider;
  /** 端点根地址，如 https://api.anthropic.com 。custom 时由用户完整填写。 */
  baseUrl: string;
  /** 模型 id。默认值随 provider 不同，见 PROVIDER_DEFAULTS。 */
  model: string;
}

/**
 * 各服务商的默认端点与模型。
 *
 * ★ model id 有时效性，换厂商前先查官方文档确认没被弃用：
 *   - DeepSeek 的 `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 弃用，
 *     官方主模型是 `deepseek-v4-flash`（1M 上下文，官方标注适合「分类、打标、
 *     批量处理」，正是本项目的场景）。填旧名会直接 400。
 *   - 模型名写错的表现是「AI 不好用」而不是报错，排查起来很费时间 —— 日志里
 *     记的是 HTTP 400 + 厂商的模糊说明，不看文档很难联想到「模型名过期了」。
 */
export const PROVIDER_DEFAULTS: Record<
  AiProvider,
  { baseUrl: string; model: string; label: string }
> = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5-20251001',
    label: 'Anthropic Claude',
  },
  openai: {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4.1-mini',
    label: 'OpenAI',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    // 2026-07-24 弃用 deepseek-chat；V4-Flash 是官方当前主模型。
    model: 'deepseek-v4-flash',
    label: 'DeepSeek',
  },
  custom: {
    // Ollama 是最常见的自建场景，给个能直接用的默认值。
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    label: 'Custom / Ollama',
  },
};

/** 一条发给模型的消息。刻意保持最小面——只需要单轮 prompt。 */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  messages: AiMessage[];
  /** 期望模型返回纯 JSON。实现里会同时用 prompt 约束与解析兜底。 */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * 覆盖默认 system 指令。
   *
   * 默认那份是给**归类**写的（「你负责把书签归进文件夹」），问答场景下不适用 ——
   * 与其把两套意图塞进一段 prompt，不如让调用方整段替换。不传则用默认。
   */
  system?: string;
}

/** 归一化后的文本结果。 */
export interface AiResult {
  text: string;
  /** provider 报告的 token 用量；服务端未返回时为 undefined。 */
  usage?: { input: number; output: number };
}

/**
 * 服务商返回的错误已经是可读文本（各家 message 字段都还算清楚），所以这里只在
 * 消息为空时兜一句 —— 绝不让错误退化成 "[object Object]"（见 lib/errors.ts 的约定）。
 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** 归一化 base URL：去掉末尾斜杠，避免拼出 `//v1/...`。 */
function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

/**
 * 判断某个错误是不是「CORS 挡住了」——这类错误浏览器只会给一个不透明的
 * TypeError，没有任何服务端信息，只能靠特征识别并引导用户去授权 host 权限。
 *
 * 判据（Chrome / Firefox 实测形状）：
 *   - 消息含 "Failed to fetch" / "NetworkError"
 *   - 或 TypeError 且消息里出现 "fetch"
 * 服务端返回 4xx/5xx 时是正常的 HTTP 错误（有状态码），不会落到这里。
 */
export function isCorsBlocked(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return true;
  return e instanceof TypeError && /fetch/i.test(msg);
}

/** Anthropic 的 CORS 需要显式 opt-in 头；其它家不需要。 */
function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

/** OpenAI 兼容家（OpenAI / DeepSeek / 自建）统一走 Bearer 认证 + /chat/completions。 */
function openAiHeaders(apiKey: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

/**
 * 拼出 system 指令。Anthropic 有独立的 system 字段，OpenAI 兼容家只能塞成
 * 第一条 system 消息 —— 这是两家协议唯一的结构性差异，其余部分刻意保持一致。
 */
function systemPrompt(cfg: AiConfig, wantJson: boolean): string {
  const base =
    'You are a bookmark management assistant. You organize bookmarks into folders and tags. ' +
    'Be concise. Prefer existing folder names when they fit.';
  return wantJson
    ? `${base}\n\nReturn ONLY a JSON object matching the requested shape. No prose, no markdown fences.`
    : base;
}

/** 请求的 url / headers / body 三元组，供 complete 与 streamComplete 共用。 */
interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

/**
 * 拼出请求三元组。
 *
 * complete() 与 streamComplete() **必须**共用这一份 —— 两家协议的字段名差异
 * （system 位置、max_tokens 命名）只该有一处实现，否则迟早漂移出「流式能用、
 * 非流式不能」这种只有一端正确的 bug。
 *
 * @param opts.stream 请求 SSE 流式响应
 * @param opts.json   要求模型返回纯 JSON（仅非流式场景用；流式下无法解析）
 */
function buildRequest(
  cfg: AiConfig,
  apiKey: string,
  req: AiRequest,
  opts: { stream: boolean; json: boolean },
): BuiltRequest {
  const base = trimBase(cfg.baseUrl);
  const sys = req.system ?? systemPrompt(cfg, opts.json);
  const msgs = req.messages.filter((m) => m.content.trim() !== '');
  if (msgs.length === 0) throw new AiError('empty prompt');

  const temperature = req.temperature ?? (opts.json ? 0 : 0.3);
  const maxTokens = req.maxTokens ?? (opts.json ? 1024 : 512);

  const url = cfg.provider === 'anthropic' ? `${base}/v1/messages` : `${base}/v1/chat/completions`;
  const headers = cfg.provider === 'anthropic' ? anthropicHeaders(apiKey) : openAiHeaders(apiKey);

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: maxTokens,
    temperature,
  };
  if (opts.stream) body.stream = true;

  // OpenAI 兼容家：system 作为首条消息；Anthropic：走顶层 system 字段。
  //
  // ★ system 段开 prompt caching。归类时 system + 「复用现有文件夹名」那段
  // 每批都完全相同，是最理想的前缀：Anthropic 命中后输入价降约 90%
  // （claude-haiku 写缓存 1.25×、命中 0.1×），DeepSeek 的前缀缓存命中价更是
  // 低到 $0.0028/M（不命中 $0.14/M，差 50 倍）。
  // 17 批的归类任务里，命中缓存后每批只为「新增的书签列表 + 少量变化」付费。
  // 成本比不缓存低一个数量级，代价只是多两个字段。
  //
  // 只能标 system：标到 user 消息上等于每批都是新前缀，永远不命中。
  const payload =
    cfg.provider === 'anthropic'
      ? {
          ...body,
          system: [{ type: 'text', text: sys, cache_control: { type: 'ephemeral' } }],
          messages: msgs,
        }
      : { ...body, messages: [{ role: 'system', content: sys }, ...msgs] };

  return { url, headers, payload };
}

/**
 * 发一次请求并返回归一化结果。
 *
 * @param cfg 端点与模型配置
 * @param apiKey 用户自己的 key（只在本机内存里，绝不落日志）
 * @throws {AiError} HTTP 非 2xx、或响应结构不符合预期
 */
export async function complete(cfg: AiConfig, apiKey: string, req: AiRequest): Promise<AiResult> {
  if (!apiKey) throw new AiError('missing API key');
  const { url, headers, payload } = buildRequest(cfg, apiKey, req, {
    stream: false,
    json: req.json === true,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    });
  } catch (e) {
    // 网络层失败：区分「CORS 挡了」（可引导授权权限）与「真的网络不通」。
    if (isCorsBlocked(e)) {
      throw new AiError(
        'blocked by CORS or unreachable — if this is a self-hosted endpoint, grant host access',
      );
    }
    throw new AiError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) {
    throw new AiError(await readErrorBody(res), res.status);
  }

  const data: unknown = await res.json();
  return cfg.provider === 'anthropic' ? parseAnthropic(data) : parseOpenAi(data);
}

/** 从错误响应里挖出人能读的原因。各家形状不同，逐个试。 */
async function readErrorBody(res: Response): Promise<string> {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
  try {
    const j = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const err = j.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const m = (err as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    if (typeof j.message === 'string') return j.message;
  } catch {
    /* 非 JSON（如网关返回 HTML 错误页）→ 落到下面截断原文 */
  }
  return raw.slice(0, 200) || `HTTP ${res.status}`;
}

function parseAnthropic(data: unknown): AiResult {
  const d = data as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (d.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
  if (!text) throw new AiError('empty response from Anthropic');
  return {
    text,
    usage:
      d.usage?.input_tokens !== undefined
        ? { input: d.usage.input_tokens, output: d.usage.output_tokens ?? 0 }
        : undefined,
  };
}

function parseOpenAi(data: unknown): AiResult {
  const d = data as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = d.choices?.[0]?.message?.content;
  // content 正常是 string；部分网关会返回数组形式的内容块，统一压成文本。
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((c) =>
              typeof (c as { text?: unknown })?.text === 'string'
                ? (c as { text: string }).text
                : '',
            )
            .join('')
        : '';
  if (!text) throw new AiError('empty response');
  return {
    text,
    usage:
      d.usage?.prompt_tokens !== undefined
        ? { input: d.usage.prompt_tokens, output: d.usage.completion_tokens ?? 0 }
        : undefined,
  };
}

/**
 * 从模型输出里取出 JSON。
 *
 * 小模型即使被明确要求「只返回 JSON」，也常带 markdown 围栏（```json ... ```）或
 * 前后废话。这里按「围栏 → 首个 `{` 到末个 `}`」的顺序逐级兜底，避免因为格式噪音
 * 让整次归类失败 —— 那会直接变成用户视角的「AI 不好用」。
 *
 * @throws {AiError} 确实找不到合法 JSON 时抛出，调用方应如实告知用户
 */
export function extractJson(text: string): unknown {
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const inner = tryParse(fence[1]);
    if (inner !== undefined) return inner;
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParse(text.slice(start, end + 1));
    if (sliced !== undefined) return sliced;
  }

  throw new AiError('model did not return parseable JSON');
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** SSE 里代表「流结束」的哨兵（OpenAI 的 `[DONE]`、Anthropic 的 `message_stop`）。 */
const SSE_DONE = Symbol('sse-done');

/**
 * 解析一行 SSE，返回本次要产出的文本、结束标记，或 null（该行无内容）。
 *
 * 只认 `data:` 行：`event:` / `id:` / `retry:` 与以 `:` 开头的注释（部分端点的保活
 * 心跳）一律忽略 —— 我们靠 payload 里的 `type` 字段区分事件，不依赖 `event:` 行。
 *
 * 半截 JSON 直接丢弃而不是抛错：极少数端点会在非事件边界切块，丢一行总好过
 * 让整次回答失败。
 */
function parseSseLine(cfg: AiConfig, line: string): string | typeof SSE_DONE | null {
  const t = line.trim();
  if (!t || t.startsWith(':') || !t.startsWith('data:')) return null;
  const data = t.slice(5).trim();
  if (!data) return null;
  if (data === '[DONE]') return SSE_DONE;

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }

  if (cfg.provider === 'anthropic') {
    const d = json as {
      type?: string;
      delta?: { type?: string; text?: string };
      error?: { message?: string };
    };
    // 流中途的错误走 event: error，HTTP 状态码此时已经是 200，只能靠 payload 识别
    if (d.type === 'error') throw new AiError(d.error?.message ?? 'stream error');
    if (d.type === 'message_stop') return SSE_DONE;
    // content_block_delta 才带文本；message_start / content_block_start / ping 不带
    if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') {
      return d.delta.text || null;
    }
    return null;
  }

  const d = json as {
    choices?: Array<{ delta?: { content?: unknown } }>;
    error?: { message?: string };
  };
  if (d.error?.message) throw new AiError(d.error.message);
  const c = d.choices?.[0]?.delta?.content;
  // 部分网关会返回数组形式的内容块，与 parseOpenAi 保持一致地压平
  if (typeof c === 'string') return c || null;
  if (Array.isArray(c)) {
    const text = c
      .map((p) =>
        typeof (p as { text?: unknown })?.text === 'string' ? (p as { text: string }).text : '',
      )
      .join('');
    return text || null;
  }
  return null;
}

/**
 * 流式请求：逐块产出新增的文本（不是累计文本，调用方自己拼）。
 *
 * @throws {AiError} HTTP 非 2xx、流中途的 error 事件、或响应没有 body
 *
 * 用户点「停止」时应通过 `req.signal` 中断：此时 `reader.read()` 抛 AbortError，
 * 调用方据此区分「用户主动取消」与「真的失败」，不要当成错误提示。
 */
export async function* streamComplete(
  cfg: AiConfig,
  apiKey: string,
  req: AiRequest,
): AsyncGenerator<string, void, undefined> {
  if (!apiKey) throw new AiError('missing API key');
  const { url, headers, payload } = buildRequest(cfg, apiKey, req, { stream: true, json: false });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: req.signal,
    });
  } catch (e) {
    if (isCorsBlocked(e)) {
      throw new AiError(
        'blocked by CORS or unreachable — if this is a self-hosted endpoint, grant host access',
      );
    }
    throw new AiError(e instanceof Error ? e.message : String(e));
  }

  if (!res.ok) throw new AiError(await readErrorBody(res), res.status);
  if (!res.body) throw new AiError('endpoint returned no stream body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 一个网络块里可能有多行，也可能只有半行 —— 只消费完整的行，
      // 残行留在 buffer 里等下一块，否则跨块的长 JSON 会被截断。
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        const out = parseSseLine(cfg, line);
        if (out === SSE_DONE) return;
        if (out) yield out;
        nl = buffer.indexOf('\n');
      }
    }
    // 收尾：最后一行可能没有换行符
    const tail = parseSseLine(cfg, buffer.replace(/\r$/, ''));
    if (tail && tail !== SSE_DONE) yield tail;
  } finally {
    // 提前 return（拿到 [DONE]）或抛错时都要释放底层连接
    reader.cancel().catch(() => {});
  }
}
