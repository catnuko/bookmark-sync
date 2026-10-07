/**
 * tests/ai/semanticDedupe.test.ts — AI 语义判重的本地候选生成 + 结果归组。
 *
 * 这一层错起来是**静默且昂贵**的：候选生成漏了 → 白花钱还漏判；归组错了 →
 * 界面上出现一个错误的「这 3 条是同一篇」结论，用户照着删就删错了。
 * 所以重点覆盖：本地候选的取舍边界、跨站加分、以及模型输出不可信时的四道过滤。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildCandidates,
  classifySemanticDupes,
  type CandidatePair,
  type SemanticItem,
} from '../../src/ai/semanticDedupe.js';
import type { AiConfig } from '../../src/ai/provider.js';

const CFG: AiConfig = { provider: 'openai', baseUrl: 'https://x.dev', model: 'm' };
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** 让模型返回指定的 pairs（JSON）。 */
function stubPairs(pairs: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ pairs }) } }] }),
  })) as unknown as typeof fetch;
}

const item = (id: string, title: string, url: string): SemanticItem => ({ id, title, url });

describe('buildCandidates · 本地候选生成', () => {
  it('少于 2 条直接返回空', () => {
    expect(buildCandidates([])).toEqual([]);
    expect(buildCandidates([item('a', 'x', 'https://a.com/x')])).toEqual([]);
  });

  it('同标题跨站 → 成对，且含跨站加分', () => {
    const pairs = buildCandidates([
      item('a', 'rust ownership guide', 'https://a.com/rust-ownership-guide'),
      item('b', 'rust ownership guide', 'https://b.com/rust-ownership-guide'),
    ]);
    expect(pairs).toHaveLength(1);
    // 标题 Jaccard 1 ×2 + slug Jaccard 1 ×1.5 + 跨站 0.3
    expect(pairs[0].score).toBeCloseTo(3.8, 5);
  });

  it('★ 同站不加分（同站重复本该由精确判重抓到）', () => {
    const cross = buildCandidates([
      item('a', 'rust ownership guide', 'https://a.com/rust-ownership-guide'),
      item('b', 'rust ownership guide', 'https://b.com/rust-ownership-guide'),
    ]);
    const same = buildCandidates([
      item('a', 'rust ownership guide', 'https://a.com/rust-ownership-guide'),
      item('b', 'rust ownership guide', 'https://a.com/rust-ownership-guide-2'),
    ]);
    expect(same[0].score).toBeCloseTo(cross[0].score - 0.3, 5);
  });

  it('毫不相关的两条不产生候选（低于 minScore 直接丢）', () => {
    const pairs = buildCandidates([
      item('a', 'rust ownership', 'https://a.com/rust-ownership'),
      item('b', '红烧肉菜谱', 'https://b.com/braised-pork'),
    ]);
    expect(pairs).toEqual([]);
  });

  it('minScore 可调高，把弱候选挡掉', () => {
    const items = [
      item('a', 'alpha beta', 'https://a.com/alpha-beta'),
      item('b', 'alpha zeta', 'https://b.com/alpha-zeta'),
    ];
    expect(buildCandidates(items)).toHaveLength(1);
    expect(buildCandidates(items, { minScore: 99 })).toEqual([]);
  });

  it('★ maxPerItem 封顶：一条书签不会霸占整个候选表', () => {
    // A 同时与 B、C 相似（共享不同 token，各自 DF=2 不会先被常见词阈值砍掉）
    const items = [
      item('A', 'alpha beta', 'https://a.com/alpha-beta'),
      item('B', 'alpha zeta', 'https://b.com/alpha-zeta'),
      item('C', 'beta omega', 'https://c.com/beta-omega'),
    ];
    const all = buildCandidates(items, { maxPerItem: 5 });
    expect(all).toHaveLength(2); // (A,B) 与 (A,C)
    const capped = buildCandidates(items, { maxPerItem: 1 });
    expect(capped).toHaveLength(1); // A 只能出现在一对里
  });

  it('非 http(s) 的书签不产生 slug（但标题仍可参与）', () => {
    const pairs = buildCandidates([
      item('a', 'chrome extensions', 'chrome://extensions'),
      item('b', 'chrome extensions', 'chrome://settings'),
    ]);
    // 标题 Jaccard 1 ×2 = 2，slug 为空 → 0，hostOf 两者都是空串 → 不算跨站
    expect(pairs).toHaveLength(1);
    expect(pairs[0].score).toBeCloseTo(2, 5);
  });
});

describe('classifySemanticDupes · 归组与过滤', () => {
  const items = [
    item('A', 'short', 'https://a.com/x'),
    item('B', 'a much longer title', 'https://b.com/x'),
    item('C', 'mid title', 'https://c.com/x'),
  ];
  const pairs: CandidatePair[] = [
    { a: 'A', b: 'B', score: 1.5 },
    { a: 'B', b: 'C', score: 1.5 },
  ];

  it('★ 传递关系合成一组（A-B、B-C ⇒ 一组三条）', async () => {
    stubPairs([
      { i: 0, j: 1, confidence: 'high', reason: 'same article' },
      { i: 1, j: 2, confidence: 'high', reason: 'same article' },
    ]);
    const r = await classifySemanticDupes(CFG, 'k', items, pairs);
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0];
    expect([g.keepId, ...g.dupIds].sort()).toEqual(['A', 'B', 'C']);
    expect(g.confidence).toBe('high');
    expect(g.reason).toBe('same article');
  });

  it('保留项用 pickKeeper 的规则（标题更长的胜出）', async () => {
    stubPairs([
      { i: 0, j: 1, confidence: 'high', reason: '' },
      { i: 1, j: 2, confidence: 'high', reason: '' },
    ]);
    const r = await classifySemanticDupes(CFG, 'k', items, pairs);
    expect(r.groups[0].keepId).toBe('B'); // 'a much longer title'
  });

  it('★ 模型说 high 但本地相似度很低 → 下调为 medium', async () => {
    stubPairs([{ i: 0, j: 1, confidence: 'high', reason: '' }]);
    const weak: CandidatePair[] = [{ a: 'A', b: 'B', score: 0.2 }];
    const r = await classifySemanticDupes(CFG, 'k', items, weak);
    expect(r.groups[0].confidence).toBe('medium');
  });

  it('组置信度取组内最低：一环 medium 则整组 medium', async () => {
    stubPairs([
      { i: 0, j: 1, confidence: 'high', reason: '' },
      { i: 1, j: 2, confidence: 'medium', reason: '' },
    ]);
    const r = await classifySemanticDupes(CFG, 'k', items, pairs);
    expect(r.groups[0].confidence).toBe('medium');
  });

  it('★ 越界下标 / 自环 / 非整数被丢弃，不写进组', async () => {
    stubPairs([
      { i: 0, j: 1, confidence: 'high', reason: '' },
      { i: 0, j: 99, confidence: 'high', reason: '' }, // 越界
      { i: 2, j: 2, confidence: 'high', reason: '' }, // 自环
      { i: 1.5, j: 2, confidence: 'high', reason: '' }, // 非整数
      { i: 'x', j: 2, confidence: 'high', reason: '' }, // 非数字
    ]);
    const r = await classifySemanticDupes(CFG, 'k', items, pairs);
    expect(r.groups).toHaveLength(1);
    expect([r.groups[0].keepId, ...r.groups[0].dupIds].sort()).toEqual(['A', 'B']);
  });

  it('confidence 只认 high，其余一律 medium', async () => {
    stubPairs([{ i: 0, j: 1, confidence: 'CERTAIN', reason: '' }]);
    const r = await classifySemanticDupes(CFG, 'k', items, pairs);
    expect(r.groups[0].confidence).toBe('medium');
  });

  it('pairs 为空 → 不发请求直接返回', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await classifySemanticDupes(CFG, 'k', items, []);
    expect(r).toEqual({ groups: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('整批请求失败 → 不猜，返回空组', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const r = await classifySemanticDupes(CFG, 'k', items, pairs);
    expect(r.groups).toEqual([]);
  });
});
