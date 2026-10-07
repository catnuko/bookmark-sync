/**
 * tests/omnibox.test.ts — 地址栏搜索的注册与建议生成。
 *
 * 两个必须守住的行为：
 *   1. description 是**标记串**，书签标题里的 `&` `<` 必须转义 —— 不转义会让
 *      整条建议渲染失败（标题里带「A & B」是常事）。
 *   2. 没有选中建议、输入也不是 URL 时**什么都不做** —— 这是「纯本地零外发」
 *      承诺的边界，绝不能拿用户输入去拼搜索引擎 URL。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChromeTreeNode } from '../src/sync/index.js';

type Handler = (...args: unknown[]) => void;

/** 造一棵树：1 条带 XML 特殊字符的标题 + 11 条普通「rust」书签。 */
function makeTree(): ChromeTreeNode[] {
  const children: ChromeTreeNode[] = [
    // 标题刻意取短：同分时短标题排前，这样它一定落在 8 条上限之内
    { id: '10', title: 'Rust & <x>', url: 'https://doc.rust-lang.org/book' },
    ...Array.from({ length: 11 }, (_, i) => ({
      id: `1${i}`,
      title: `rust item ${i}`,
      url: `https://e.dev/${i}`,
    })),
  ];
  return [{ id: '0', title: '', children: [{ id: '1', title: '书签栏', children }] }];
}

let handlers: Record<string, Handler>;
let suggest: ReturnType<typeof vi.fn>;
let tabsCreate: ReturnType<typeof vi.fn>;
let getTree: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  handlers = {};
  suggest = vi.fn();
  tabsCreate = vi.fn(async () => undefined);
  getTree = vi.fn(async () => makeTree());

  vi.stubGlobal('chrome', {
    bookmarks: { getTree },
    tabs: { create: tabsCreate },
    omnibox: {
      setDefaultSuggestion: vi.fn(),
      onInputStarted: { addListener: (cb: Handler) => void (handlers.started = cb) },
      onInputChanged: { addListener: (cb: Handler) => void (handlers.changed = cb) },
      onInputEntered: { addListener: (cb: Handler) => void (handlers.entered = cb) },
      onInputCancelled: { addListener: (cb: Handler) => void (handlers.cancelled = cb) },
    },
  });

  // api 是模块级绑定 → 必须在 stub 之后重新加载
  vi.resetModules();
  const mod = await import('../src/omnibox.js');
  mod.registerOmnibox();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 触发 onInputChanged 并等内部 async 跑完。 */
async function change(text: string) {
  handlers.changed(text, suggest);
  await vi.waitFor(() => expect(suggest).toHaveBeenCalled());
  return suggest.mock.calls.at(-1)?.[0] as Array<{ content: string; description: string }>;
}

describe('onInputChanged · 建议生成', () => {
  it('空输入 → 空建议，且不读书签树', async () => {
    handlers.changed('   ', suggest);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith([]));
    expect(getTree).not.toHaveBeenCalled();
  });

  it('命中多条 → 最多 8 条', async () => {
    const hits = await change('rust');
    expect(hits).toHaveLength(8);
  });

  it('★ 标题里的 & < > 被转义，不会破坏 description 标记', async () => {
    const hits = await change('rust');
    const special = hits.find((h) => h.content === 'https://doc.rust-lang.org/book');
    expect(special).toBeDefined();
    expect(special!.description).toContain('&amp;');
    expect(special!.description).toContain('&lt;x&gt;');
    // 原始尖括号绝不能漏出去（<match>/<dim> 是唯一允许的标签）
    expect(special!.description).not.toContain('<x>');
  });

  it('★ 命中片段用 <match> 加粗', async () => {
    const hits = await change('rust');
    const special = hits.find((h) => h.content === 'https://doc.rust-lang.org/book');
    expect(special!.description).toContain('<match>Rust</match>');
  });

  it('content 放的是书签 URL（选中回车可直接打开）', async () => {
    const hits = await change('rust');
    for (const h of hits) expect(h.content).toMatch(/^https?:\/\//);
  });

  it('无命中 → 空建议', async () => {
    const hits = await change('zzzzz');
    expect(hits).toEqual([]);
  });

  it('检索抛错 → 退回空建议，不抛穿', async () => {
    getTree.mockRejectedValueOnce(new Error('boom'));
    handlers.changed('rust', suggest);
    await vi.waitFor(() => expect(suggest).toHaveBeenCalledWith([]));
  });
});

describe('onInputEntered · 回车行为', () => {
  it('输入是 http(s) URL → 直接打开', async () => {
    handlers.entered('https://example.com/page', 'currentTab');
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalled());
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'https://example.com/page' });
  });

  it('输入是关键词 → 检索并打开最匹配的一条', async () => {
    handlers.entered('rust', 'currentTab');
    await vi.waitFor(() => expect(tabsCreate).toHaveBeenCalled());
    const url = (tabsCreate.mock.calls[0][0] as { url: string }).url;
    expect(url).toMatch(/^https:\/\/(doc\.rust-lang\.org|e\.dev)\//);
  });

  it('★ 输入既不是 URL 也无命中 → 什么都不做（不拼搜索引擎，零外发）', async () => {
    handlers.entered('zzzzz', 'currentTab');
    await new Promise((r) => setTimeout(r, 0));
    expect(tabsCreate).not.toHaveBeenCalled();
  });

  it('空输入 → 什么都不做', async () => {
    handlers.entered('   ', 'currentTab');
    await new Promise((r) => setTimeout(r, 0));
    expect(tabsCreate).not.toHaveBeenCalled();
  });
});
