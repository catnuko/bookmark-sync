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
 * ## 不做的事
 *
 * - 不做任何重试 / 退避：AI 是用户主动触发的，失败就如实报错，重试只会掩盖问题。
 * - 不打任何遥测：明文和 key 都不出本机，没什么可统计的。
 * - 不做流式：书签打标签/归类这类任务的输出都是几十字的 JSON，流式的复杂度换不来收益。
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

/** 只用于「配置是否存在」的判断；真实 key 单独存，见 providerKey.ts。 */
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
    model: 'deepseek-chat',
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

/**
 * 发一次请求并返回归一化结果。
 *
 * @param cfg 端点与模型配置
 * @param apiKey 用户自己的 key（只在本机内存里，绝不落日志）
 * @throws {AiError} HTTP 非 2xx、或响应结构不符合预期
 */
export async function complete(cfg: AiConfig, apiKey: string, req: AiRequest): Promise<AiResult> {
  if (!apiKey) throw new AiError('missing API key');
  const base = trimBase(cfg.baseUrl);
  const wantJson = req.json === true;
  const sys = systemPrompt(cfg, wantJson);
  const msgs = req.messages.filter((m) => m.content.trim() !== '');
  if (msgs.length === 0) throw new AiError('empty prompt');

  const temperature = req.temperature ?? (wantJson ? 0 : 0.3);
  const maxTokens = req.maxTokens ?? (wantJson ? 1024 : 512);

  const url = cfg.provider === 'anthropic' ? `${base}/v1/messages` : `${base}/v1/chat/completions`;
  const headers = cfg.provider === 'anthropic' ? anthropicHeaders(apiKey) : openAiHeaders(apiKey);

  // OpenAI 兼容家：system 作为首条消息；Anthropic：走顶层 system 字段。
  const payload =
    cfg.provider === 'anthropic'
      ? { model: cfg.model, max_tokens: maxTokens, temperature, system: sys, messages: msgs }
      : {
          model: cfg.model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: 'system', content: sys }, ...msgs],
        };

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
