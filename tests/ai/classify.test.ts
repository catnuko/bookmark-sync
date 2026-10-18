/**
 * tests/ai/classify.test.ts — 批量归类的输出校验与容错。
 *
 * 重点是**不信任模型输出**：小模型会给出越界下标、重复 id、非整数、错的结构。
 * 这些如果不拦下来，会直接变成「把用户的书签 move 到奇怪的地方」—— 是会损坏
 * 用户数据的那类 bug，不是显示问题。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyBookmarks, hostOf } from '../../src/ai/classify.js';
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

  it('★ 组的数量有上限（防模型把 60 条拆成 60 个文件夹）', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ folder: `F${i}`, ids: [i] }));
    stubByCall([{ groups: many }]);
    const r = await classifyBookmarks(CFG, 'k', items(30));
    // 源码是 raw.slice(0, 12)，30 组进来只能活 12 组。断言具体值而不是
    // `toBeLessThanOrEqual(12)` —— 后者恒真，模型输出若有一天变成全量透传
    // （或上限被误调成 30）它也照样绿。
    //
    // 被丢掉的组**不能**静默变成"已归类"：前 12 组（F0…F11）活着，
    // 剩下 18 条书签必须如实落到 unclassified。
    expect(r.groups).toHaveLength(12);
    expect(r.groups.map((g) => g.folder)).toEqual([
      'F0',
      'F1',
      'F2',
      'F3',
      'F4',
      'F5',
      'F6',
      'F7',
      'F8',
      'F9',
      'F10',
      'F11',
    ]);
    expect(r.unclassified).toEqual(
      items(30)
        .slice(12)
        .map((b) => b.id),
    );
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

describe('classify prompt 的信息量', () => {
  /** 抓取每次请求的 prompt 文本。 */
  function capturePrompts(): string[] {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, o: any) => {
      const body = JSON.parse(o.body);
      // messages[0] 是本模块发的 user prompt（Anthropic 分支下会映射到 system/user，
      // 这里取「含书签列表的那一条」，避免绑死协议细节）。
      for (const m of body.messages ?? []) {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (c.includes('Classify these')) seen.push(c);
      }
      if (body.system) seen.push(String(body.system));
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
    return seen;
  }

  it('★ 每条带域名（分类最强的信号）', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(CFG, 'k', [
      { id: 'a', title: '官方文档', url: 'https://docs.python.org/3/tutorial' },
      { id: 'b', title: '某新闻', url: 'https://news.ycombinator.com/item?id=1' },
    ]);
    expect(seen[0]).toContain('docs.python.org');
    expect(seen[0]).toContain('news.ycombinator.com');
  });

  it('★ 域名去 www.，标题保留', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(CFG, 'k', [
      { id: 'a', title: 'Vue 3 文档', url: 'https://www.vuejs.org/guide' },
    ]);
    expect(seen[0]).toContain('vuejs.org');
    expect(seen[0]).not.toContain('www.vuejs.org');
    expect(seen[0]).toContain('Vue 3 文档');
  });

  it('★ 不把整条 URL 塞进 prompt（路径是噪音、token 会翻几倍）', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(CFG, 'k', [
      { id: 'a', title: '长文', url: 'https://example.com/2024/03/some-very-long-slug-here' },
    ]);
    expect(seen[0]).not.toContain('some-very-long-slug-here');
  });

  it('★ 明确指示「命名跟随现有文件夹的语言」', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(
      CFG,
      'k',
      [{ id: 'a', title: 'x', url: 'https://e.dev/a' }],
      ['前端', '后端'],
    );
    expect(seen[0]).toMatch(/same language as the existing folder names/i);
    // 没有现有文件夹时也要有兜底规则
    const noReuse = capturePrompts();
    await classifyBookmarks(CFG, 'k', [{ id: 'a', title: 'x', url: 'https://e.dev/a' }]);
    expect(noReuse[0]).toMatch(/dominant language of the bookmark titles/i);
  });

  it('★ 域名作为强先验写进 rules（而不只是出现在数据里）', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(CFG, 'k', [{ id: 'a', title: 'x', url: 'https://e.dev/a' }]);
    expect(seen[0]).toMatch(/use it as a strong hint/i);
  });

  it('标题为空时退化成 URL 而不是留空', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(CFG, 'k', [{ id: 'a', title: '', url: 'https://e.dev/page' }]);
    expect(seen[0]).toContain('e.dev/page');
  });

  it('非法 URL 不产生括号残渣', async () => {
    const seen = capturePrompts();
    await classifyBookmarks(CFG, 'k', [{ id: 'a', title: 'x', url: 'not a url' }]);
    // 应是「0. x」而不是「0. x ()」
    expect(seen[0]).toContain('0. x\n');
    expect(seen[0]).not.toContain('()');
  });
});

describe('hostOf', () => {
  it('去 www.、转小写', () => {
    expect(hostOf('https://WWW.VueJS.org/guide')).toBe('vuejs.org');
  });

  it('非法 URL 返回空串（不是 undefined）', () => {
    expect(hostOf('nonsense')).toBe('');
  });

  it('非 http(s) 协议返回空串', () => {
    expect(hostOf('chrome://extensions')).toBe('');
  });
});
