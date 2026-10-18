/**
 * tests/ai/abort.test.ts — 长任务可取消语义（P1-2）。
 *
 * ## 要证明什么
 *
 * 三个 AI 长任务（classifyBookmarks / classifySemanticDupes / suggestRepairs）
 * 与 applyPlan 都必须能在「批次边界」被取消：
 *   1. 已完成的批次结果**保留**（不回滚、不丢）；
 *   2. 未发起的批次**不再发起**（不继续烧 token）；
 *   3. 取消不是错误：用户主动 abort 不应被当成失败上报。
 *
 * ## 探针（防止假通过）
 *
 * classify.ts 的批次边界有一行 `if (signal?.aborted) { ... return null }`。
 * 本文件末尾的 probe 套件会**临时删掉这行**重新跑「提前 abort」用例，断言
 * 用例会变红（会真的发起请求）；还原后恢复绿色。这证明断言不是在测空气。
 *
 * 注意：provider.ts 现在会把 AbortError 原样透传（不再包成 AiError），
 * 否则「取消」会在 classifyOneBatch 里被 .catch(()=>null) 吞成「整批失败」，
 * 与真正的失败无法区分。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { ChromeTreeNode } from '../../src/sync/index.js';
import type { AiConfig } from '../../src/ai/provider.js';
import { classifyBookmarks } from '../../src/ai/classify.js';
import { classifySemanticDupes } from '../../src/ai/semanticDedupe.js';
import { suggestRepairs } from '../../src/ai/linkCheck.js';
import { applyPlan, type OrganizeBookmarksAPI } from '../../src/ai/organize.js';

const CFG: AiConfig = { provider: 'openai', baseUrl: 'https://x.dev', model: 'm' };
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

// ---- 工具：构造数据 ----

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`,
    title: `T${i}`,
    url: `https://e.dev/${i}`,
  }));
}

function semItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `sid${i}`,
    title: `S${i}`,
    url: `https://e.dev/${i}`,
  }));
}

/** 成功响应：把第 0 个下标归到一个文件夹，并带 token 用量（100/20）。 */
function okResp() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ groups: [{ folder: 'A', ids: [0] }] }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  } as unknown as Response;
}

/** 受控 fetch：每次调用建立一个 pending deferred，并捕获当时的 signal。 */
function controlledFetch() {
  const calls: Array<{
    resolve: (r: Response) => void;
    reject: (e: unknown) => void;
    signal?: AbortSignal;
  }> = [];
  globalThis.fetch = vi.fn(async (_u: unknown, opts?: { signal?: AbortSignal }) => {
    let entry!: {
      resolve: (r: Response) => void;
      reject: (e: unknown) => void;
      signal?: AbortSignal;
    };
    const p = new Promise<Response>((resolve, reject) => {
      entry = { resolve, reject, signal: opts?.signal };
    });
    calls.push(entry);
    return p;
  }) as unknown as typeof fetch;
  return calls;
}

/** 让并发 worker 都跨过「调用 fetch」这一步（deferred 全部建立）。 */
async function flushFetchStarts() {
  // 足够长的 macrotask，确保 mapLimit 的 worker 各进入并调用一次 fetch
  await new Promise((r) => setTimeout(r, 20));
}

describe('classifyBookmarks · 取消语义', () => {
  it('提前 abort → 0 次请求、全部未归类、aborted 标志置位', async () => {
    const ac = new AbortController();
    ac.abort(); // 调用前就取消
    const spy = vi.fn(async () => okResp());
    globalThis.fetch = spy as unknown as typeof fetch;

    const r = await classifyBookmarks(CFG, 'k', items(180), [], ac.signal);

    expect(spy).not.toHaveBeenCalled(); // 边界检查挡住了所有批次
    expect(r.groups).toEqual([]);
    expect(r.unclassified).toHaveLength(180); // 没丢任何一条
    expect(r.aborted).toBe(true);
    expect(r.usage).toBeUndefined(); // token 计数没因未发起的批增长
  });

  it('中途 abort → 已完成批次保留、未发起的批被拦截、usage 只算已完成', async () => {
    const ac = new AbortController();
    const calls = controlledFetch();

    // 6 批（360 项 / 60），而并发只有 3：前 3 批会立即被 worker 取出并发起请求（pending），
    // 后 3 批要等前 3 批完成后 worker 才去取 —— 这时我们已经 abort，边界检查会拦下它们。
    const p = classifyBookmarks(CFG, 'k', items(360), [], ac.signal);
    await flushFetchStarts();
    expect(calls.length).toBe(3); // 只有前 3 批越过了边界检查并发起了请求
    // 让第 0 批成功，第 1、2 批在 abort 后 reject（按已捕获的 signal 感知）
    calls[0].resolve(okResp());
    ac.abort();
    for (let i = 1; i < calls.length; i++) {
      const entry = calls[i];
      if (entry.signal?.aborted) {
        entry.reject(new DOMException('Aborted', 'AbortError'));
      } else {
        entry.resolve(okResp());
      }
    }

    const r = await p;
    // 前 3 批：批 0 成功（归 1 条，余 59 条未归类），批 1、2 被取消（各 60 条）。
    // 后 3 批：在边界检查点被发现已 abort，不再发起请求，整批进 unclassified（各 60 条）。
    // 未归类 = 59 + 60 + 60 + 60 + 60 + 60 = 359。
    expect(r.groups).toHaveLength(1);
    expect(r.unclassified).toHaveLength(359);
    expect(r.aborted).toBe(true);
    // usage 只来自那 1 个完成的批，不会把未发起/被取消的批也算进去
    expect(r.usage?.input).toBe(100);
    expect(r.usage?.output).toBe(20);
  });
});

describe('classifySemanticDupes · 取消语义', () => {
  it('提前 abort → 0 次请求、groups 空、aborted 置位', async () => {
    const ac = new AbortController();
    ac.abort();
    const spy = vi.fn(async () => okResp());
    globalThis.fetch = spy as unknown as typeof fetch;

    const its = semItems(10);
    const pairs = its.map((a, i) => ({ a: a.id, b: its[(i + 1) % its.length].id, score: 1 }));
    const r = await classifySemanticDupes(CFG, 'k', its, pairs, ac.signal);

    expect(spy).not.toHaveBeenCalled();
    expect(r.groups).toEqual([]);
    expect(r.aborted).toBe(true);
  });
});

describe('suggestRepairs · 取消语义', () => {
  it('提前 abort → 0 次请求、items 空、aborted 置位', async () => {
    const ac = new AbortController();
    ac.abort();
    const spy = vi.fn(async () => okResp());
    globalThis.fetch = spy as unknown as typeof fetch;

    // LinkCheckResult 最小形状：只需 id/title/url/status/path
    const broken = Array.from({ length: 80 }, (_, i) => ({
      id: `bid${i}`,
      title: `B${i}`,
      url: `https://dead.dev/${i}`,
      path: '/',
      status: 'broken' as const,
    }));
    const r = await suggestRepairs(CFG, 'k', broken, ac.signal);

    expect(spy).not.toHaveBeenCalled();
    expect(r.items).toEqual([]);
    expect(r.aborted).toBe(true);
  });
});

describe('applyPlan · shouldStop 中途停止', () => {
  /** 记录一切写操作的 fake chrome。 */
  function makeFake(initial: ChromeTreeNode[]) {
    const calls: Array<{ op: string; args: unknown }> = [];
    const api: OrganizeBookmarksAPI = {
      getTree: vi.fn(async () => initial),
      move: vi.fn(async (id: string, dest: { parentId: string; index?: number }) => {
        calls.push({ op: 'move', args: { id, dest } });
      }),
      create: vi.fn(async (props: { parentId: string; title: string }) => {
        calls.push({ op: 'create', args: props });
        return { id: 'newX' };
      }),
    };
    return { api, calls };
  }

  const tree: ChromeTreeNode[] = [
    {
      id: '0',
      parentId: undefined,
      title: '',
      children: [
        {
          id: '10',
          parentId: '0',
          title: '杂货',
          children: [
            { id: '100', parentId: '10', index: 0, title: 'a', url: 'https://a' },
            { id: '101', parentId: '10', index: 1, title: 'b', url: 'https://b' },
            { id: '11', parentId: '10', index: 2, title: '子', children: [] },
          ],
        },
      ],
    },
  ];

  const plan = {
    scopeId: '10',
    scopeTitle: '杂货',
    total: 2,
    groups: [
      {
        key: 'g0',
        folder: '新',
        kind: 'create' as const,
        items: [
          { id: '100', title: 'a', url: 'https://a' },
          { id: '101', title: 'b', url: 'https://b' },
        ],
      },
    ],
    unclassified: [],
  };

  it('★ 第一次 move 后即叫停：已 move 的保留，未 move 的不应用（半程不回滚）', async () => {
    const { api, calls } = makeFake(tree);
    let moves = 0;
    const stop = () => moves > 0; // 第 1 次 move 完成后才停
    const wrapped: OrganizeBookmarksAPI = {
      ...api,
      move: async (id, dest) => {
        moves += 1;
        return api.move(id, dest);
      },
    };

    const r = await applyPlan(wrapped, plan, ['g0'], undefined, stop);

    expect(r.movedCount).toBe(1); // 第 1 条落地
    expect(calls.filter((c) => c.op === 'move')).toHaveLength(1);
    // 已完成的都成功了：ok 仍为 true（半程停止 ≠ 失败，遵守「半程不回滚」语义）
    expect(r.ok).toBe(true);
    // 文件夹仍建了（第一阶段在 stop 前跑完），已建的不撤销
    expect(r.createdCount).toBe(1);
  });
});

// ============================================================
// 探针套件：把 classify.ts 复制成「去掉批次边界 aborted 检查」的临时文件并 import，
// 证明上面的「提前 abort → 0 次请求」用例不是假通过。运行后删除临时文件。
//
// ★ 为什么用临时文件而不是改源码 + resetModules：
// vitest 会把已 import 的 classify.ts 编译结果缓存在模块图里，运行时改磁盘文件
// 后即便 vi.resetModules() 也读不到新内容（Vite transform 缓存）。复制到新文件
// 是唯一可靠的「拿到无边界版本」的办法。
// ============================================================
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('PROBE · 边界检查不可删（防止假通过）', () => {
  const src = path.resolve(__dirname, '../../src/ai/classify.ts');
  const probeFile = path.resolve(__dirname, '../../src/ai/.probe-classify.ts');
  const probeMarker = '    if (signal?.aborted) {';

  beforeEach(() => {
    const original = fs.readFileSync(src, 'utf8');
    // 制造「没有取消保护」的源码：把边界检查替换成永不成立的 `if (false)`
    const mutated = original.replace(probeMarker, '    if (false) {');
    expect(mutated).not.toEqual(original); // 确保真的改到了（marker 必须存在）
    fs.writeFileSync(probeFile, mutated, 'utf8');
  });

  afterEach(() => {
    // 无论如何清理临时文件，保证工作树不被探针污染
    if (fs.existsSync(probeFile)) fs.unlinkSync(probeFile);
  });

  // it.fails：这个用例「预期会失败」。它证明「提前 abort → 0 次请求」不是假通过——
  // 一旦 classify.ts 的边界检查被误删，本用例会从「失败」变成「通过」，从而让 it.fails 本身报错，
  // 反向报警。所以它永远应该保持红色，绿色才是异常。
  it.fails('★ 删掉边界检查后，提前 abort 会真的发起请求（用例应变红）', async () => {
    const ac = new AbortController();
    ac.abort();
    const spy = vi.fn(async () => okResp());
    globalThis.fetch = spy as unknown as typeof fetch;

    // import 临时文件（去掉了边界检查的版本）；该文件由 beforeEach 运行时生成，tsc 静态找不到，故忽略
    // @ts-expect-error 临时探针文件在测试运行时才生成
    const { classifyBookmarks: probeFn } = await import('../../src/ai/.probe-classify.js');
    const r = await probeFn(CFG, 'k', items(180), [], ac.signal);

    // 没有边界检查 → 即使 signal 已 aborted，批次仍会发起请求并被吞成失败
    // （provider 透传 AbortError → .catch(()=>null) → 整批进 unclassified）。
    // 因此 fetch 一定被调用过 —— 这与「提前 abort → 0 次请求」的正常断言相反，
    // 故意让绿色用例在这里变红，证明断言在测真东西。
    expect(spy).not.toHaveBeenCalled(); // ← 探针预期：删边界后这行会失败（spy 被调用了）
    // 明确量化：180 项 = 3 批，删边界后这 3 批全部越过了检查点并发起请求
    expect(spy).toHaveBeenCalledTimes(3);
    // 顺带校验：删边界后 aborted 标志不再置位（因为根本没机会设置它）
    expect(r.aborted).toBeUndefined();
  });
});
