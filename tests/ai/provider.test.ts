/**
 * tests/ai/provider.test.ts — BYOK LLM 客户端的协议适配与 JSON 兜底。
 *
 * 重点覆盖两类「静默失效」：
 *   1. 两家协议形状不同（system 字段 vs system 消息），拼错就是 400；
 *   2. 小模型即使被要求「只返回 JSON」也常带围栏 / 废话 —— extractJson 不兜住
 *      就等于「AI 不好用」，而用户看不出到底是模型还是解析的问题。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  complete,
  extractJson,
  isCorsBlocked,
  AiError,
  PROVIDER_DEFAULTS,
} from '../../src/ai/provider.js';

const realFetch = globalThis.fetch;

/** 造一个只返回固定 JSON 的 fetch 桩，并记录收到的请求体与头。 */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  globalThis.fetch = vi.fn(async (url: any, opts: any) => {
    calls.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) });
    const status = init.status ?? 200;
    return {
      ok: init.ok ?? status < 400,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('complete · Anthropic 协议', () => {
  it('走 /v1/messages，system 放顶层字段，带 dangerous-direct-browser-access 头', async () => {
    const calls = stubFetch({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 3, output_tokens: 1 },
    });
    const res = await complete({ ...PROVIDER_DEFAULTS.anthropic, provider: 'anthropic' }, 'k', {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    // CORS 关键头：少了它浏览器直接挡掉
    expect(calls[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(calls[0].headers['x-api-key']).toBe('k');
    // Anthropic 的 system 是顶层字段（不是一条消息），且为了 prompt caching
    // 必须是 [{type:'text',...}] 数组形状 —— 字符串形式带不了 cache_control。
    // 归类任务分 17 批，system 每批相同，命中缓存后输入价降约一个数量级。
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(JSON.stringify(calls[0].body.system)).toContain('bookmark');
    expect(calls[0].body.system).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('bookmark'),
        cache_control: { type: 'ephemeral' },
      }),
    ]);
    expect(res.text).toBe('ok');
    expect(res.usage).toEqual({ input: 3, output: 1 });
  });

  it('拼接多段 text，只取 type==="text" 的块', async () => {
    stubFetch({
      content: [
        { type: 'thinking', text: 'ignored' },
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
      ],
    });
    const res = await complete({ ...PROVIDER_DEFAULTS.anthropic, provider: 'anthropic' }, 'k', {
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.text).toBe('AB');
  });
});

describe('complete · OpenAI 兼容协议', () => {
  it('走 /v1/chat/completions，Bearer 认证，system 作为首条消息', async () => {
    const calls = stubFetch({
      choices: [{ message: { content: 'pong' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    });
    const res = await complete({ ...PROVIDER_DEFAULTS.openai, provider: 'openai' }, 'sk-x', {
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers.authorization).toBe('Bearer sk-x');
    expect(calls[0].body.messages[0].role).toBe('system');
    expect(res.text).toBe('pong');
  });

  it('content 为数组内容块时压成文本（部分网关的形状）', async () => {
    stubFetch({
      choices: [
        {
          message: {
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        },
      ],
    });
    const res = await complete({ ...PROVIDER_DEFAULTS.deepseek, provider: 'deepseek' }, 'k', {
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.text).toBe('ab');
  });

  it('baseUrl 末尾斜杠不产生双斜杠', async () => {
    const calls = stubFetch({ choices: [{ message: { content: 'x' } }] });
    await complete({ provider: 'openai', baseUrl: 'https://api.openai.com/', model: 'm' }, 'k', {
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });
});

describe('complete · 错误处理', () => {
  it('HTTP 4xx：挖出服务端 message，不退化成 [object Object]', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'invalid x-api-key' } }),
        }) as unknown as Response,
    ) as unknown as typeof fetch;

    await expect(
      complete({ ...PROVIDER_DEFAULTS.anthropic, provider: 'anthropic' }, 'bad', {
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('invalid x-api-key');
  });

  it('error 为字符串时也能取到', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: 'flat message' }),
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(
      complete({ provider: 'openai', baseUrl: 'https://x.dev', model: 'm' }, 'k', {
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow('flat message');
  });

  it('非 JSON 错误体（网关 HTML）→ 截断原文而非空串', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: false,
          status: 502,
          text: async () => '<html>Bad Gateway</html>',
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(
      complete({ provider: 'openai', baseUrl: 'https://x.dev', model: 'm' }, 'k', {
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow(/Bad Gateway/);
  });

  it('缺 key / 空 prompt 在发请求前就抛（不浪费一次往返）', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(
      complete({ provider: 'openai', baseUrl: 'https://x.dev', model: 'm' }, '', {
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow(AiError);
    await expect(
      complete({ provider: 'openai', baseUrl: 'https://x.dev', model: 'm' }, 'k', { messages: [] }),
    ).rejects.toThrow(AiError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('空白消息被过滤掉（全空白 → 空 prompt 抛错）', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(
      complete({ provider: 'openai', baseUrl: 'https://x.dev', model: 'm' }, 'k', {
        messages: [{ role: 'user', content: '   ' }],
      }),
    ).rejects.toThrow('empty prompt');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isCorsBlocked', () => {
  it('识别 fetch 失败类错误（自建端点没 CORS 头的典型表现）', () => {
    expect(isCorsBlocked(new TypeError('Failed to fetch'))).toBe(true);
    expect(isCorsBlocked(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(
      true,
    );
    expect(isCorsBlocked(new TypeError('Load failed'))).toBe(true);
  });

  it('普通错误不算 CORS（避免误导用户去授权权限）', () => {
    expect(isCorsBlocked(new Error('boom'))).toBe(false);
    expect(isCorsBlocked(new AiError('HTTP 401'))).toBe(false);
  });

  it('HTTP 401/500 不被误判为 CORS', () => {
    expect(isCorsBlocked(new TypeError('Unauthorized'))).toBe(false);
  });
});

describe('extractJson · 小模型格式兜底', () => {
  it('裸 JSON 直接解', () => {
    expect(extractJson('{"groups":[{"folder":"a","ids":[0]}]}')).toEqual({
      groups: [{ folder: 'a', ids: [0] }],
    });
  });

  it('markdown 围栏（带 json 标注）', () => {
    expect(extractJson('```json\n{"folder":"x"}\n```')).toEqual({ folder: 'x' });
  });

  it('markdown 围栏（无标注）', () => {
    expect(extractJson('```\n{"folder":"y"}\n```')).toEqual({ folder: 'y' });
  });

  it('前后有废话 → 截取首个 { 到末个 }', () => {
    expect(extractJson('Sure! Here you go:\n{"folder":"z"}\nHope that helps.')).toEqual({
      folder: 'z',
    });
  });

  it('嵌套大括号不被截断（取的是最外层）', () => {
    expect(extractJson('{"groups":[{"folder":"a","ids":[0,1]}],"n":2}')).toEqual({
      groups: [{ folder: 'a', ids: [0, 1] }],
      n: 2,
    });
  });

  it('确实没有 JSON → 抛可读错误（不返回 undefined 让下游空指针）', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/parseable JSON/);
  });
});
