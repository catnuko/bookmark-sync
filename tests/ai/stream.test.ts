/**
 * tests/ai/stream.test.ts — streamComplete 的 SSE 解析。
 *
 * 与 provider.test.ts（非流式 / JSON 兜底）分开：这一层的 bug 长相完全不同 ——
 * 都是「看起来能用但偶发丢字」，出问题时用户只会觉得 AI 回答缺了半句。
 *
 * 两类最容易踩的：
 *   1. 网络块边界 ≠ SSE 行边界：一个 JSON 事件被切成两半，按块解析就会丢；
 *   2. 两家结束信号不同（OpenAI `[DONE]`、Anthropic `message_stop`），漏判会挂住或多吐。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { PROVIDER_DEFAULTS, streamComplete, type AiConfig } from '../../src/ai/provider.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const ANTHROPIC: AiConfig = { ...PROVIDER_DEFAULTS.anthropic, provider: 'anthropic' };
const OPENAI: AiConfig = { ...PROVIDER_DEFAULTS.openai, provider: 'openai' };

/**
 * 造一个把给定字符串按块吐出的 fetch 桩。
 * chunks 的切法就是网络块的切法 —— 测试「跨块」场景时故意从中间切开。
 */
function stubStream(chunks: string[], init: { ok?: boolean; status?: number } = {}) {
  const enc = new TextEncoder();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const t of chunks) c.enqueue(enc.encode(t));
      c.close();
    },
  });
  globalThis.fetch = vi.fn(async (url: unknown, opts: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    const status = init.status ?? 200;
    return {
      ok: init.ok ?? status < 400,
      status,
      text: async () => 'err body',
      body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

/** 把整条流拼起来，等价于 UI 里逐块追加。 */
async function collect(cfg: AiConfig, key = 'k', extra: Record<string, unknown> = {}) {
  let out = '';
  const gen = streamComplete(cfg, key, {
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  });
  for await (const chunk of gen) out += chunk;
  return out;
}

const anthropicSse = (obj: unknown) => 'event: x\ndata: ' + JSON.stringify(obj) + '\n\n';
const openaiSse = (obj: unknown) => 'data: ' + JSON.stringify(obj) + '\n\n';
const DONE = 'data: [DONE]\n\n';

describe('streamComplete · 请求构造', () => {
  it('请求体带 stream:true（否则服务端回整段 JSON，解析结果全空）', async () => {
    const calls = stubStream([DONE]);
    await collect(ANTHROPIC);
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('OpenAI 兼容家走 /v1/chat/completions', async () => {
    const calls = stubStream([DONE]);
    await collect(OPENAI);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('system 可整段覆盖（问答用的 system 与归类的不是同一份）', async () => {
    const calls = stubStream([DONE]);
    for await (const _ of streamComplete(ANTHROPIC, 'k', {
      system: 'QA MODE',
      messages: [{ role: 'user', content: 'hi' }],
    }))
      void _;
    // 覆盖后的 system 同样走 [{type:'text',...}] 数组形状（带 cache_control）。
    // 断言 text 而不是整个对象：数组形状是实现细节（为 prompt caching），
    // 真正要守住的是「调用方给的 system 整段生效、没被默认那段拼接」。
    expect(calls[0].body.system).toEqual([
      expect.objectContaining({ type: 'text', text: 'QA MODE' }),
    ]);
  });

  it('缺 key 在发请求前抛错', async () => {
    stubStream([]);
    await expect(collect(ANTHROPIC, '')).rejects.toThrow(/missing API key/);
  });

  it('空 prompt 在发请求前抛错', async () => {
    stubStream([]);
    await expect(
      (async () => {
        for await (const _ of streamComplete(ANTHROPIC, 'k', { messages: [] })) void _;
      })(),
    ).rejects.toThrow(/empty prompt/);
  });
});

describe('streamComplete · Anthropic SSE', () => {
  it('只取 content_block_delta/text_delta，忽略 ping 与结构性事件', async () => {
    stubStream([
      anthropicSse({ type: 'message_start' }),
      anthropicSse({ type: 'ping' }),
      anthropicSse({ type: 'content_block_start' }),
      anthropicSse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }),
      anthropicSse({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }),
      anthropicSse({ type: 'content_block_stop' }),
      anthropicSse({ type: 'message_stop' }),
    ]);
    expect(await collect(ANTHROPIC)).toBe('Hello world');
  });

  it('★ 一个事件被切在两个网络块之间，仍能拼出完整文本', async () => {
    const full = anthropicSse({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: '完整' },
    });
    const cut = Math.floor(full.length / 2);
    stubStream([full.slice(0, cut), full.slice(cut), anthropicSse({ type: 'message_stop' })]);
    expect(await collect(ANTHROPIC)).toBe('完整');
  });

  it('message_stop 之后的残余不再产出', async () => {
    stubStream([
      anthropicSse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } }),
      anthropicSse({ type: 'message_stop' }),
      anthropicSse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'LEAK' } }),
    ]);
    expect(await collect(ANTHROPIC)).toBe('A');
  });

  it('流中途的 error 事件抛可读错误（此时 HTTP 已经是 200）', async () => {
    stubStream([anthropicSse({ type: 'error', error: { message: 'overloaded' } })]);
    await expect(collect(ANTHROPIC)).rejects.toThrow(/overloaded/);
  });

  it('最后一行没有换行符也能收尾', async () => {
    stubStream([
      anthropicSse({ type: 'content_block_delta', delta: { type: 'text_delta', text: '尾部' } })
        .trimEnd()
        .replace(/\n$/, ''),
    ]);
    expect(await collect(ANTHROPIC)).toBe('尾部');
  });
});

describe('streamComplete · OpenAI 兼容 SSE', () => {
  it('拼 choices[0].delta.content，遇 [DONE] 结束', async () => {
    stubStream([
      openaiSse({ choices: [{ delta: { content: 'He' } }] }),
      openaiSse({ choices: [{ delta: { content: 'llo' } }] }),
      DONE,
    ]);
    expect(await collect(OPENAI)).toBe('Hello');
  });

  it('role-only 首块（delta 无 content）不产出 "undefined"', async () => {
    stubStream([
      openaiSse({ choices: [{ delta: { role: 'assistant' } }] }),
      openaiSse({ choices: [{ delta: { content: 'ok' } }] }),
      DONE,
    ]);
    expect(await collect(OPENAI)).toBe('ok');
  });

  it('[DONE] 之后的残余不再产出', async () => {
    stubStream([
      openaiSse({ choices: [{ delta: { content: 'A' } }] }),
      DONE,
      openaiSse({ choices: [{ delta: { content: 'LEAK' } }] }),
    ]);
    expect(await collect(OPENAI)).toBe('A');
  });

  it('半截 JSON 行被丢弃，不打断整条流', async () => {
    stubStream([
      'data: {"choices":[{"delta":{"cont\n\n',
      openaiSse({ choices: [{ delta: { content: 'ok' } }] }),
      DONE,
    ]);
    expect(await collect(OPENAI)).toBe('ok');
  });

  it('注释行（: ping 保活）与 event:/id: 行被忽略', async () => {
    stubStream([
      ': keep-alive\n\n',
      'event: delta\nid: 7\n',
      openaiSse({ choices: [{ delta: { content: 'ok' } }] }),
      DONE,
    ]);
    expect(await collect(OPENAI)).toBe('ok');
  });

  it('HTTP 非 2xx 抛服务端给的原因', async () => {
    stubStream([], { ok: false, status: 401 });
    await expect(collect(OPENAI)).rejects.toThrow(/err body/);
  });
});

describe('streamComplete · 中断', () => {
  it('signal 已中断：fetch 阶段就失败，不产生任何产出', async () => {
    const ac = new AbortController();
    ac.abort();
    globalThis.fetch = vi.fn(async (_u: unknown, o: { signal?: AbortSignal }) => {
      if (o.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
      throw new Error('should not reach here');
    }) as unknown as typeof fetch;

    await expect(collect(OPENAI, 'k', { signal: ac.signal })).rejects.toThrow(/abort/i);
  });

  it('流中途中断：read() 以 AbortError 结束，调用方据此区分「用户停」与「失败」', async () => {
    const enc = new TextEncoder();
    const ac = new AbortController();
    // 第一块正常给，之后 pull 挂起 —— 直到 abort 才 reject，模拟真实的流中途取消
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(openaiSse({ choices: [{ delta: { content: 'x' } }] })));
          },
          pull() {
            return new Promise<void>((_, rej) => {
              ac.signal.addEventListener(
                'abort',
                () => rej(new DOMException('aborted', 'AbortError')),
                { once: true },
              );
            });
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const run = (async () => {
      for await (const _ of streamComplete(OPENAI, 'k', {
        messages: [{ role: 'user', content: 'hi' }],
        signal: ac.signal,
      }))
        void _;
    })();
    setTimeout(() => ac.abort(), 20);

    await expect(run).rejects.toThrow(/abort/i);
  });
});
