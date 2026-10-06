/**
 * tests/ai/dedupe.test.ts — 纯本地 URL 规范化去重。
 *
 * 判重的错误有两条方向，后果完全不同：
 *   - **漏判**（本该判重没判）→ 用户多点一次，无害；
 *   - **误判**（不该判重却判了）→ 建议用户删掉一篇不同的书签，比不去重更糟。
 * 所以测试重心压在「不能误判」上：语义参数（`?id=`、`?page=`、`?v=`）必须活着。
 */

import { describe, it, expect } from 'vitest';
import { findDuplicates, normalizeUrl } from '../../src/ai/dedupe.js';
import type { ChromeTreeNode } from '../../src/sync/index.js';

describe('normalizeUrl', () => {
  it('去掉 utm_* 追踪参数', () => {
    expect(normalizeUrl('https://a.com/p?utm_source=x&utm_medium=y&id=7')).toBe(
      'https://a.com/p?id=7',
    );
  });

  it('去掉常见广告/分享追踪参数', () => {
    expect(normalizeUrl('https://a.com/p?fbclid=abc&gclid=def')).toBe('https://a.com/p');
    expect(normalizeUrl('https://a.com/p?spm=1&from=timeline')).toBe('https://a.com/p');
  });

  it('★ 保留语义参数（误判 = 建议删掉不同的书签）', () => {
    // id 不同 = 两篇不同的文章，绝不能撞到同一组
    expect(normalizeUrl('https://a.com/p?id=1')).not.toBe(normalizeUrl('https://a.com/p?id=2'));
    // page / v / q 同理
    expect(normalizeUrl('https://a.com/p?page=2')).not.toBe(normalizeUrl('https://a.com/p?page=3'));
    expect(normalizeUrl('https://a.com/p?v=2')).not.toBe(normalizeUrl('https://a.com/p?v=3'));
    expect(normalizeUrl('https://a.com/s?q=rust')).not.toBe(normalizeUrl('https://a.com/s?q=go'));
  });

  it('参数顺序不同视为同一 URL', () => {
    expect(normalizeUrl('https://a.com/p?b=2&a=1')).toBe(normalizeUrl('https://a.com/p?a=1&b=2'));
  });

  it('host 大小写与默认端口归一', () => {
    expect(normalizeUrl('https://A.COM/p')).toBe('https://a.com/p');
    expect(normalizeUrl('https://a.com:443/p')).toBe('https://a.com/p');
    expect(normalizeUrl('http://a.com:80/p')).toBe('http://a.com/p');
  });

  it('非默认端口保留（那是不同服务）', () => {
    expect(normalizeUrl('http://a.com:8080/p')).toBe('http://a.com:8080/p');
  });

  it('尾斜杠归一，但根路径保留', () => {
    expect(normalizeUrl('https://a.com/p/')).toBe('https://a.com/p');
    expect(normalizeUrl('https://a.com/')).toBe('https://a.com/');
  });

  it('AMP / 移动端路径变体归一', () => {
    expect(normalizeUrl('https://a.com/post/amp')).toBe(normalizeUrl('https://a.com/post'));
    expect(normalizeUrl('https://a.com/post/amp/')).toBe(normalizeUrl('https://a.com/post'));
    expect(normalizeUrl('https://a.com/post/m')).toBe(normalizeUrl('https://a.com/post'));
  });

  it('★ 剥掉变体后不能把路径剥空（/amp 本身是站点首页）', () => {
    // 有意保守：剥完只剩空路径时**保留原样**。`https://a.com/amp` 到底是 AMP 版
    // 首页还是独立页面无从判断，猜错就是误判（建议用户删掉不同的书签）。
    expect(normalizeUrl('https://a.com/amp')).toBe('https://a.com/amp');
    expect(normalizeUrl('https://a.com/amp/')).toBe('https://a.com/amp'); // 仅尾斜杠归一
  });

  it('★ 保留 fragment（多数站点 hash 不改内容，删了会误判）', () => {
    expect(normalizeUrl('https://a.com/p#section')).not.toBe(normalizeUrl('https://a.com/p'));
  });

  it('非 http(s) 与非法 URL 原样返回', () => {
    expect(normalizeUrl('chrome://extensions')).toBe('chrome://extensions');
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

/** 简易树构造：id → 书签。 */
function treeOf(...items: Array<{ id: string; title: string; url: string }>): ChromeTreeNode[] {
  return [{ id: '0', title: '', children: items }];
}

describe('findDuplicates', () => {
  it('识别追踪参数造成的重复', () => {
    const groups = findDuplicates(
      treeOf(
        { id: 'a', title: 'Vue 3 文档', url: 'https://vuejs.org/guide?utm_source=twitter' },
        { id: 'b', title: 'Vue 3 文档', url: 'https://vuejs.org/guide' },
      ),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].dupIds).toHaveLength(1);
    expect(groups[0].key).toBe('https://vuejs.org/guide');
  });

  it('★ 语义参数不同不判重', () => {
    const groups = findDuplicates(
      treeOf(
        { id: 'a', title: '文章 1', url: 'https://x.com/p?id=1' },
        { id: 'b', title: '文章 2', url: 'https://x.com/p?id=2' },
      ),
    );
    expect(groups).toEqual([]);
  });

  it('三条一组时全部识别，并挑一个保留', () => {
    const groups = findDuplicates(
      treeOf(
        { id: 'a', title: '同页', url: 'https://x.com/p' },
        { id: 'b', title: '同页?utm=1', url: 'https://x.com/p?utm_source=a' },
        { id: 'c', title: '同页/amp', url: 'https://x.com/p/amp' },
      ),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].dupIds).toHaveLength(2);
    expect(groups[0].dupIds).not.toContain(groups[0].keepId);
  });

  it('保留标题更完整的那条', () => {
    const groups = findDuplicates(
      treeOf(
        { id: 'a', title: 'Vue.js 官方指南', url: 'https://vuejs.org/guide' },
        { id: 'b', title: '', url: 'https://vuejs.org/guide?utm_source=x' },
      ),
    );
    expect(groups[0].keepId).toBe('a');
  });

  it('标题等长时保留 URL 更短的那条（干净版）', () => {
    const groups = findDuplicates(
      treeOf(
        { id: 'a', title: '同长标题', url: 'https://x.com/p?utm_source=aaaaaaaaaaaaaaaa' },
        { id: 'b', title: '同长标题', url: 'https://x.com/p' },
      ),
    );
    expect(groups[0].keepId).toBe('b');
  });

  it('保留谁的结果是确定的（同树两次跑同一结果）', () => {
    const tree = treeOf(
      { id: 'z', title: 'AB', url: 'https://x.com/p' },
      { id: 'y', title: 'AB', url: 'https://x.com/p' },
    );
    expect(findDuplicates(tree)[0].keepId).toBe(findDuplicates(tree)[0].keepId);
  });

  it('无重复返回空', () => {
    expect(findDuplicates(treeOf({ id: 'a', title: 'A', url: 'https://a.com' }))).toEqual([]);
  });

  it('非 http(s) 书签不参与判重', () => {
    expect(
      findDuplicates(
        treeOf(
          { id: 'a', title: 'X', url: 'chrome://extensions' },
          { id: 'b', title: 'X', url: 'chrome://extensions' },
        ),
      ),
    ).toEqual([]);
  });

  it('递归进子文件夹', () => {
    const tree: ChromeTreeNode[] = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: 'f',
            title: '技术',
            children: [
              { id: 'a', title: 'Vue', url: 'https://vuejs.org/guide' },
              { id: 'b', title: 'Vue', url: 'https://vuejs.org/guide#x' },
            ],
          },
        ],
      },
    ];
    // fragment 保留 → 不该判重
    expect(findDuplicates(tree)).toEqual([]);
  });

  it('组数超上限时截断，不静默少报', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `i${i}`,
      title: 'SAME',
      url: 'https://x.com/p',
    }));
    expect(findDuplicates(treeOf(...items))).toHaveLength(1); // 30 条同 URL = 1 组
  });

  it('多条重复组按重复条数降序', () => {
    const groups = findDuplicates(
      treeOf(
        { id: 'a1', title: 'A', url: 'https://a.com/p' },
        { id: 'a2', title: 'A', url: 'https://a.com/p?utm_source=a' },
        { id: 'a3', title: 'A', url: 'https://a.com/p?utm_source=b' },
        { id: 'b1', title: 'B', url: 'https://b.com/p' },
        { id: 'b2', title: 'B', url: 'https://b.com/p?utm_source=a' },
      ),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].dupIds).toHaveLength(2); // 3 条一组排前
    expect(groups[1].dupIds).toHaveLength(1);
  });
});
