/**
 * src/omnibox.ts — 地址栏搜索（`bs` + 空格）。
 *
 * ## 为什么放 SW 顶层注册
 *
 * `chrome.omnibox` 的事件是 MV3 的持久事件：SW 会被回收，事件到来时被唤醒并重跑
 * `background.ts` 顶层。所以 `registerOmnibox()` 必须在 SW 顶层调用（见 background.ts），
 * 不能在某个异步初始化里。
 *
 * ## 检索完全在本地
 *
 * 复用 `ai/qa.ts` 的 `searchBookmarks` —— 同一套关键词打分（标题 3 分 / 路径 1 分 /
 * URL 1 分 + 整串命中 +10），零网络、零外发。这也是本功能与「书签问答」的关键区别：
 * 问答会把候选发给模型，地址栏搜索**不会**。
 *
 * ## 建议项排版
 *
 * `description` 支持一小撮 XML 标记：`<match>`（加粗命中）、`<dim>`（弱化次要信息）、
 * `<url>`。**其余文本必须转义** `& < > " '` —— 书签标题里出现 `<` 或 `&` 是常事
 * （「A & B」「<thinking>」），不转义会让整条建议渲染失败。
 *
 * ★ 刻意用**单行** description（标题 + dim 的「路径 · 短 URL」），不用 `\n` 拼两行：
 * Chrome 对 description 里换行的处理并不稳定，一旦被折叠成空格就会出现
 * 「标题路径」粘在一起的鬼样子。单行在任何浏览器下都可读。
 *
 * ## 回车行为
 *
 * 建议项的 `content` 直接放书签 URL，所以用户选中后回车时 `onInputEntered` 收到的
 * 就是那个 URL。用户在**没有选中建议**的情况下回车，收到的是自己敲的原文 —— 这时
 * 若是合法 http(s) 就打开，否则什么都不做。
 *
 * ⚠ 「什么都不做」是刻意的：本功能的承诺是「纯本地零外发」，拿用户的输入去拼一条
 * 搜索引擎 URL 会把查询内容发出去，与承诺矛盾。宁可无反应，也不偷偷外发。
 */

import { api } from './lib/ext.js';
import { searchBookmarks } from './ai/qa.js';
import type { ChromeTreeNode } from './sync/index.js';

/** 建议条数上限。地址栏下拉能舒适阅读的条数，多于「问答」的候选上限。 */
const MAX_SUGGESTIONS = 8;

/** 树缓存 TTL。onInputChanged 每次按键都触发，短缓存即可免去重复 getTree。 */
const TREE_TTL_MS = 1500;

let treeCache: { at: number; tree: ChromeTreeNode[] } | null = null;

async function getTreeCached(): Promise<ChromeTreeNode[]> {
  const now = Date.now();
  if (treeCache && now - treeCache.at < TREE_TTL_MS) return treeCache.tree;
  const tree = (await api.bookmarks.getTree()) ?? [];
  treeCache = { at: now, tree };
  return tree;
}

/** 转义 XML 预定义实体（description 是标记串，不是纯文本）。 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把标题里命中的整串查询用 <match> 包起来（其余部分照常转义）。 */
function highlight(text: string, query: string): string {
  const q = query.trim();
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return (
    esc(text.slice(0, i)) +
    '<match>' +
    esc(text.slice(i, i + q.length)) +
    '</match>' +
    esc(text.slice(i + q.length))
  );
}

/** 展示用的短 URL：去掉协议与 www.，过长则截断。 */
function shortUrl(url: string): string {
  const s = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return s.length > 60 ? `${s.slice(0, 59)}\u2026` : s;
}

/** 该文本是否像一个可以直接打开的 http(s) 地址。 */
function asHttpUrl(text: string): string | null {
  const raw = text.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 注册 omnibox 监听。非扩展环境（测试）或浏览器不支持时静默跳过。 */
export function registerOmnibox(): void {
  const omni = api.omnibox;
  if (!omni) return;

  omni.setDefaultSuggestion({
    description: '输入关键词搜索书签（纯本地，零外发）',
  });

  omni.onInputStarted.addListener(() => {
    // 每次开始输入时刷新一次缓存，避免用到上一次会话的旧树
    treeCache = null;
  });

  omni.onInputChanged.addListener((text, suggest) => {
    void (async () => {
      const q = (text ?? '').trim();
      if (!q) {
        suggest([]);
        return;
      }
      try {
        const tree = await getTreeCached();
        const hits = searchBookmarks(tree, q, MAX_SUGGESTIONS);
        suggest(
          hits.map((c) => {
            const title = c.title || c.url;
            const sub = c.path ? `${c.path} \u00b7 ${shortUrl(c.url)}` : shortUrl(c.url);
            return {
              // content 放 URL：用户选中后回车，onInputEntered 直接拿到可打开的地址
              content: c.url,
              description: `${highlight(title, q)}  <dim>${esc(sub)}</dim>`,
            };
          }),
        );
      } catch (e) {
        console.warn('[bsync] omnibox search failed:', (e as { message?: unknown })?.message ?? e);
        suggest([]);
      }
    })();
  });

  omni.onInputEntered.addListener((text) => {
    const raw = (text ?? '').trim();
    if (!raw) return;
    // 建议项选中时 content 就是 URL；直接打开，不再检索一遍。
    const url = asHttpUrl(raw);
    if (url) {
      void api.tabs?.create({ url });
      return;
    }
    // 未选中建议、且不是合法 URL：重新检索一次，命中第一条就打开。
    void (async () => {
      try {
        const tree = await getTreeCached();
        const top = searchBookmarks(tree, raw, 1)[0];
        if (top?.url) void api.tabs?.create({ url: top.url });
        // 没命中且不是 URL → 什么都不做（见文件头「回车行为」）
      } catch {
        /* 检索失败时同样不动作 */
      }
    })();
  });

  omni.onInputCancelled.addListener(() => {
    treeCache = null;
  });
}
