/**
 * tests/ai/classify.test.ts — 批量归类的输出校验与容错。
 *
 * 重点是**不信任模型输出**：小模型会给出越界下标、重复 id、非整数、错的结构。
 * 这些如果不拦下来，会直接变成「把用户的书签 move 到奇怪的地方」—— 是会损坏
 * 用户数据的那类 bug，不是显示问题。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyBookmarks } from '../../src/ai/classify.js';
import type { AiConfig } from '../../src/ai/provider.js';

const CFG: AiConfig = { provider: 'openai', baseUrl: 'https://x.dev', model: 'm' };
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** 按批次依次返回不同的 groups（用调用序号区分）。 */
function stubByCall(responses: unknown[]) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const body = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `id${i}`,
    title: `T${i}`,
    url: `https://e.dev/${i}`,
  }));
}

describe('classifyBookmarks · 输出校验', () => {
  it('正常返回：下标映射回 bookmark id', async () => {
    stubByCall([
      {
        groups: [
          { folder: '技术', ids: [0, 1] },
          { folder: '生活', ids: [2] },
        ],
      },
    ]);
    const r = await classifyBookmarks(CFG, 'k', items(3));
    expect(r.groups).toEqual([
      { folder: '技术', ids: ['id0', 'id1'] },
      { folder: '生活', ids: ['id2'] },
    ]);
    expect(r.unclassified).toEqual([]);
  });

  it('越界下标被丢弃（防串批写错书签）', async () => {
    stubByCall([{ groups: [{ folder: 'A', ids: [0, 99, -1] }] }]);
    const r = await classifyBookmarks(CFG, 'k', items(2));
    expect(r.groups).toEqual([{ folder: 'A', ids: ['id0'] }]);
    // 越界的那两个不会变成"已归类"，会落到未归类里
    expect(r.unclassified).toEqual(['id1']);
  });

  it('非整数 / 非数字 id 被丢弃', async () => {
    stubByCall([{ groups: [{ folder: 'A', ids: [0, 'x', 1.5, null] }] }]);
    const r = await classifyBookmarks(CFG, 'k', items(2));
    expect(r.groups).toEqual([{ folder: 'A', ids: ['id0'] }]);
  });

  it('同一书签出现在两个组 → 只保留首次出现', async () => {
    stubByCall([
      {
        groups: [
          { folder: 'A', ids: [0, 1] },
          { folder: 'B', ids: [1] },
        ],
      },
    ]);
    const r = await classifyBookmarks(CFG, 'k', items(2));
    expect(r.groups).toEqual(
      [
        { folder: 'A', ids: ['id0', 'id1'] },
        { folder: 'B', ids: [] },
      ].filter((g) => g.ids.length > 0),
    );
  });

  it('folder 非字符串 / ids 非数组的组被整组丢弃', async () => {
    stubByCall([
      { groups: [{ folder: 123, ids: [0] }, { folder: 'ok', ids: 'nope' }, { ids: [1] }] },
    ]);
    const r = await classifyBookmarks(CFG, 'k', items(2));
    expect(r.groups).toEqual([]);
    expect(r.unclassified).toEqual(['id0', 'id1']);
  });

  it('groups 不是数组 → 全部记为未归类，不抛错', async () => {
    stubByCall([{ groups: 'oops' }]);
    const r = await classifyBookmarks(CFG, 'k', items(2));
    expect(r.groups).toEqual([]);
    expect(r.unclassified).toEqual(['id0', 'id1']);
  });

  it('模型漏掉的书签 → 进 unclassified（不静默丢弃）', async () => {
    stubByCall([{ groups: [{ folder: 'A', ids: [0] }] }]);
    const r = await classifyBookmarks(CFG, 'k', items(3));
    expect(r.unclassified).toEqual(['id1', 'id2']);
  });

  it('组的数量有上限（防模型把 60 条拆成 60 个文件夹）', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ folder: `F${i}`, ids: [i] }));
    stubByCall([{ groups: many }]);
    const r = await classifyBookmarks(CFG, 'k', items(30));
    expect(r.groups.length).toBeLessThanOrEqual(12);
  });
});

describe('classifyBookmarks · 容错', () => {
  it('整批请求失败 → 该批记为未归类，不抛穿', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const r = await classifyBookmarks(CFG, 'k', items(2));
    expect(r.groups).toEqual([]);
    expect(r.unclassified).toEqual(['id0', 'id1']);
  });

  it('部分批返回非 JSON 文本 → 只有那批未归类，其它批正常', async () => {
    // 批内互不依赖、并发执行，所以「哪一批拿到坏响应」不确定 —— 这里只断言
    // 「整体没崩、且坏批全进 unclassified、好批照常出结果」，不绑定具体批次。
    let bad = 0;
    globalThis.fetch = vi.fn(async () => {
      // 每 3 次里让 1 次返回不可解析的文本
      const isBad = bad++ % 3 === 0;
      const content = isBad
        ? 'sorry I cannot'
        : JSON.stringify({ groups: [{ folder: 'A', ids: [0] }] });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await classifyBookmarks(CFG, 'k', items(180)); // 三批
    // 三批都拿到了 id0 之外的东西：好批各归 1 条，坏批整批丢
    expect(r.unclassified.length).toBeGreaterThan(0);
    expect(r.groups.length).toBeGreaterThan(0);
    // 归类与未归类互不重叠，且总数守恒（没有书签凭空消失）
    const classified = r.groups.flatMap((g) => g.ids);
    expect(new Set([...classified, ...r.unclassified]).size).toBe(180);
    expect(classified.length + r.unclassified.length).toBe(180);
  });

  it('空输入直接返回，不发请求', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await classifyBookmarks(CFG, 'k', []);
    expect(r).toEqual({ groups: [], unclassified: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('分批：>60 条会拆批，且下标在批内重新编号', async () => {
    const seen: number[] = [];
    globalThis.fetch = vi.fn(async (_u: any, o: any) => {
      const body = JSON.parse(o.body);
      // 记下每批 prompt 里的条目行数，用来验证分批
      seen.push(String(body.messages[1].content).split('\n').length);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify({ groups: [{ folder: 'A', ids: [0] }] }) } },
          ],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const r = await classifyBookmarks(CFG, 'k', items(150)); // 60 + 60 + 30
    expect(seen.length).toBe(3);
    // 每批各归 1 条，映射回全局 id（0 / 60 / 120）
    expect(r.groups.flatMap((g) => g.ids)).toEqual(['id0', 'id60', 'id120']);
  });
});
