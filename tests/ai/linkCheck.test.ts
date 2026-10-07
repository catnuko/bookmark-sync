/**
 * tests/ai/linkCheck.test.ts — 链接体检的探活判定与 URL 修复落地。
 *
 * 两个地方错了代价都很高：
 *   - 探活判定：把 `unknown`（反爬 / 超时 / 5xx）误判成 `broken`，用户会照着
 *     「修复」一个其实好好的链接；反之漏判则等于白跑。
 *   - 落地：本模块是唯一会写书签 URL 的地方，快照与失败项必须如实带回，
 *     否则「撤销」会撤不干净。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applyRepairs,
  collectHttpBookmarks,
  probeUrl,
  revertRepairs,
  type RepairBookmarksAPI,
} from '../../src/ai/linkCheck.js';
import type { ChromeTreeNode } from '../../src/sync/index.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** 造一个 Response 形状的最小对象（只填 probeUrl 会读的字段）。 */
function res(init: { status?: number; url?: string; redirected?: boolean }): Response {
  return {
    status: init.status ?? 200,
    url: init.url ?? '',
    redirected: init.redirected ?? false,
  } as unknown as Response;
}

/** 固定返回同一个响应。 */
function stub(resp: Response) {
  globalThis.fetch = vi.fn(async () => resp) as unknown as typeof fetch;
}

describe('probeUrl · 状态判定口径', () => {
  it('2xx 且无跳转 → ok', async () => {
    stub(res({ status: 200 }));
    expect(await probeUrl('https://a.com/x')).toMatchObject({ status: 'ok', httpStatus: 200 });
  });

  it('404 / 410 → broken（明确的「没有这个资源」）', async () => {
    stub(res({ status: 404 }));
    expect(await probeUrl('https://a.com/x')).toMatchObject({ status: 'broken', httpStatus: 404 });
    stub(res({ status: 410 }));
    expect(await probeUrl('https://a.com/x')).toMatchObject({ status: 'broken', httpStatus: 410 });
  });

  it('★ 403 / 429 / 5xx → unknown（站点还活着，只是不给我们看）', async () => {
    for (const status of [403, 429, 500, 503]) {
      stub(res({ status }));
      const r = await probeUrl('https://a.com/x');
      expect(r.status).toBe('unknown');
      expect(r.httpStatus).toBe(status);
    }
  });

  it('★ opaque 响应（status 0）→ unknown，绝不能算失效', async () => {
    stub(res({ status: 0 }));
    expect(await probeUrl('https://a.com/x')).toMatchObject({
      status: 'unknown',
      reason: 'opaque',
    });
  });

  it('同 host 跳转 → redirect', async () => {
    stub(res({ status: 200, url: 'https://a.com/new', redirected: true }));
    const r = await probeUrl('https://a.com/old');
    expect(r.status).toBe('redirect');
    expect(r.finalUrl).toBe('https://a.com/new');
  });

  it('★ 跨 host 跳转 → changed（域名迁移，如 v3.vuejs.org → vuejs.org）', async () => {
    stub(res({ status: 200, url: 'https://new.com/x', redirected: true }));
    const r = await probeUrl('https://old.com/x');
    expect(r.status).toBe('changed');
    expect(r.finalUrl).toBe('https://new.com/x');
  });

  it('www. 与协议差异不算换站（仍是 redirect）', async () => {
    stub(res({ status: 200, url: 'https://www.a.com/x', redirected: true }));
    expect((await probeUrl('https://a.com/x')).status).toBe('redirect');
  });

  it('HEAD 405 → 退化 GET 重试一次', async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, o: any) => {
      methods.push(o.method);
      return o.method === 'HEAD' ? res({ status: 405 }) : res({ status: 200 });
    }) as unknown as typeof fetch;
    expect((await probeUrl('https://a.com/x')).status).toBe('ok');
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  it('501 同样退化 GET', async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_u: unknown, o: any) => {
      methods.push(o.method);
      return o.method === 'HEAD' ? res({ status: 501 }) : res({ status: 200 });
    }) as unknown as typeof fetch;
    await probeUrl('https://a.com/x');
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  it('网络错误 → unknown，带上原因', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const r = await probeUrl('https://a.com/x');
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('Failed to fetch');
  });

  it('★ 超时 → unknown 且 reason=timeout（不是「失效」）', async () => {
    globalThis.fetch = (_u: unknown, o: any) =>
      new Promise<Response>((_resolve, reject) => {
        // 真实 fetch 在 abort 时抛 AbortError；这里模拟同一形状
        o.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const r = await probeUrl('https://a.com/x', { timeoutMs: 10 });
    expect(r).toMatchObject({ status: 'unknown', reason: 'timeout' });
  });

  it('外部 signal 已中止时立刻放弃', async () => {
    globalThis.fetch = (_u: unknown, o: any) =>
      new Promise<Response>((_resolve, reject) => {
        if (o.signal.aborted) reject(new Error('aborted'));
        o.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await probeUrl('https://a.com/x', { signal: ctrl.signal, timeoutMs: 5000 });
    expect(r.status).toBe('unknown');
    expect(r.reason).not.toBe('timeout'); // 是外部取消，不是超时
  });
});

describe('collectHttpBookmarks', () => {
  const tree: ChromeTreeNode[] = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: '栏',
          children: [
            { id: '10', title: 'http', url: 'http://a.com/x' },
            { id: '11', title: 'https', url: 'https://b.com/y' },
            { id: '12', title: '扩展页', url: 'chrome://extensions' },
            { id: '13', title: '脚本', url: 'javascript:void(0)' },
            {
              id: '14',
              title: '文件夹',
              children: [{ id: '140', title: '深层', url: 'https://c.com/z' }],
            },
          ],
        },
      ],
    },
  ];

  it('只收 http(s)，跳过扩展页 / javascript: 等（探不了）', () => {
    const ids = collectHttpBookmarks(tree).map((b) => b.id);
    expect(ids).toEqual(['10', '11', '140']);
  });

  it('带上所在文件夹路径', () => {
    const deep = collectHttpBookmarks(tree).find((b) => b.id === '140');
    expect(deep?.path).toBe('栏 / 文件夹');
  });
});

describe('applyRepairs / revertRepairs', () => {
  function fakeBookmarks(failIds: string[] = []) {
    const calls: Array<{ id: string; url: string }> = [];
    const api: RepairBookmarksAPI = {
      async update(id, changes) {
        if (failIds.includes(id)) throw new Error(`cannot update ${id}`);
        calls.push({ id, url: changes.url });
      },
    };
    return { api, calls };
  }

  const targets = [
    { id: 'a', oldUrl: 'https://old.com/1', newUrl: 'https://new.com/1' },
    { id: 'b', oldUrl: 'https://old.com/2', newUrl: 'https://new.com/2' },
  ];

  it('全部成功 → ok，快照记下旧 URL 供撤销', async () => {
    const { api, calls } = fakeBookmarks();
    const r = await applyRepairs(api, targets);
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(2);
    expect(r.failures).toEqual([]);
    expect(r.snapshot.updated).toEqual([
      { id: 'a', oldUrl: 'https://old.com/1' },
      { id: 'b', oldUrl: 'https://old.com/2' },
    ]);
    expect(calls).toEqual([
      { id: 'a', url: 'https://new.com/1' },
      { id: 'b', url: 'https://new.com/2' },
    ]);
  });

  it('★ 半程失败：已成功的保留、失败项如实带回，且失败项不进快照', async () => {
    const { api } = fakeBookmarks(['b']);
    const r = await applyRepairs(api, targets);
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(1);
    expect(r.failures).toEqual([{ id: 'b', message: 'cannot update b' }]);
    // 只记成功的那条 —— 撤销时不能去写一个从没改过的节点
    expect(r.snapshot.updated).toEqual([{ id: 'a', oldUrl: 'https://old.com/1' }]);
  });

  it('进度回调按完成数递增', async () => {
    const { api } = fakeBookmarks();
    const seen: Array<[number, number]> = [];
    await applyRepairs(api, targets, (d, t) => seen.push([d, t]));
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('撤销把旧 URL 原样写回', async () => {
    const { api, calls } = fakeBookmarks();
    const r = await revertRepairs(api, { updated: [{ id: 'a', oldUrl: 'https://old.com/1' }] });
    expect(r.reverted).toBe(1);
    expect(r.failed).toEqual([]);
    expect(calls).toEqual([{ id: 'a', url: 'https://old.com/1' }]);
  });

  it('撤销时单条失败不中断其余', async () => {
    const { api } = fakeBookmarks(['b']);
    const r = await revertRepairs(api, {
      updated: [
        { id: 'a', oldUrl: 'https://old.com/1' },
        { id: 'b', oldUrl: 'https://old.com/2' },
      ],
    });
    expect(r.reverted).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].id).toBe('b');
  });
});
