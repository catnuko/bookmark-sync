/**
 * tests/ai/qa.test.ts — 书签问答的本地检索层。
 *
 * 这一层的错误是**静默**的：召回不对时用户只会看到「AI 答不上来」，看不出是检索
 * 还是模型的问题。所以重点覆盖切词（尤其中英混排）与「宁可返回空也不塞无关书签」。
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CANDIDATE_LIMIT,
  buildQaPrompt,
  flattenBookmarks,
  searchBookmarks,
  tokenize,
  type QaCandidate,
} from '../../src/ai/qa.js';
import type { ChromeTreeNode } from '../../src/sync/index.js';

const tree: ChromeTreeNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: '书签栏',
        children: [
          { id: '10', title: 'React 教程', url: 'https://react.dev/learn' },
          { id: '11', title: 'Vue 3 文档', url: 'https://vuejs.org/guide' },
          {
            id: '12',
            title: '技术',
            children: [{ id: '120', title: 'Rust 入门', url: 'https://doc.rust-lang.org/book' }],
          },
        ],
      },
      {
        id: '2',
        title: '其他书签',
        children: [{ id: '20', title: '红烧肉菜谱', url: 'https://example.com/recipe' }],
      },
    ],
  },
];

describe('tokenize', () => {
  it('英文按词切，长度 <2 的丢弃', () => {
    expect(tokenize('React tutorial')).toEqual(['react', 'tutorial']);
    expect(tokenize('a React')).toEqual(['react']);
  });

  it('中文按 2-gram 切（整句无空格也要能匹配标题片段）', () => {
    expect(tokenize('菜谱')).toEqual(['菜谱']);
    expect(tokenize('红烧肉')).toEqual(['红烧', '烧肉']);
  });

  it('★ 中英混排不把拉丁词拆成单字符', () => {
    // 曾经写成「遇到非 CJK 就单字符 push」，导致 react 被拆成 r/e/a/c/t ——
    // 那样几乎每条书签都会命中，检索等于失效。
    expect(tokenize('我存的React教程')).toEqual(['我存', '存的', 'react', '教程']);
  });

  it('标点作为分隔符，且结果去重', () => {
    expect(tokenize('React, 教程 React')).toEqual(['react', '教程']);
    expect(tokenize('---')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });
});

describe('flattenBookmarks', () => {
  it('只取书签节点，并带上文件夹路径', () => {
    const flat = flattenBookmarks(tree);
    expect(flat.map((b) => b.id).sort()).toEqual(['10', '11', '120', '20']);
    const rust = flat.find((b) => b.id === '120');
    expect(rust?.path).toBe('书签栏 / 技术');
    expect(rust?.url).toBe('https://doc.rust-lang.org/book');
  });

  it('空树返回空数组，不抛错', () => {
    expect(flattenBookmarks([])).toEqual([]);
  });
});

describe('searchBookmarks', () => {
  it('按关键词命中标题', () => {
    const hits = searchBookmarks(tree, 'react');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('10');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('中文 2-gram 能命中中文标题', () => {
    expect(searchBookmarks(tree, '菜谱').map((b) => b.id)).toEqual(['20']);
  });

  it('命中文件夹路径也算（书签在「技术」下）', () => {
    expect(searchBookmarks(tree, '技术').map((b) => b.id)).toEqual(['120']);
  });

  it('★ 无命中时返回空数组，而不是把整棵树塞回去', () => {
    // 这是隐私与成本的底线：检索不到就不该有任何书签离开本机。
    expect(searchBookmarks(tree, 'zzzznotfound')).toEqual([]);
    expect(searchBookmarks(tree, '   ')).toEqual([]);
    expect(searchBookmarks(tree, '!!!')).toEqual([]);
  });

  it('标题命中权重高于 URL（用户记的是标题）', () => {
    const byTitle = searchBookmarks(tree, 'react')[0];
    const byUrl = searchBookmarks(tree, 'vuejs.org');
    expect(byUrl[0].id).toBe('11');
    expect(byTitle.score).toBeGreaterThan(byUrl[0].score);
  });

  it('整串原样命中标题时得分最高（最强的「就是这条」信号）', () => {
    const exact = searchBookmarks(tree, 'React 教程')[0];
    const loose = searchBookmarks(tree, 'react')[0];
    expect(exact.id).toBe('10');
    expect(exact.score).toBeGreaterThan(loose.score);
  });

  it('遵守 limit', () => {
    const many: ChromeTreeNode[] = [
      {
        id: '0',
        title: '',
        children: Array.from({ length: 100 }, (_, i) => ({
          id: String(i),
          title: `react 笔记 ${i}`,
          url: `https://example.com/${i}`,
        })),
      },
    ];
    expect(searchBookmarks(many, 'react', 5)).toHaveLength(5);
    expect(searchBookmarks(many, 'react')).toHaveLength(DEFAULT_CANDIDATE_LIMIT);
  });
});

describe('buildQaPrompt', () => {
  const cand = (over: Partial<QaCandidate> = {}): QaCandidate => ({
    id: '1',
    title: 'React 教程',
    url: 'https://react.dev/learn',
    path: '书签栏 / 技术',
    score: 9,
    ...over,
  });

  it('带上问题、候选内容与引用要求', () => {
    const p = buildQaPrompt('react 在哪', [cand()]);
    expect(p).toContain('react 在哪');
    expect(p).toContain('React 教程');
    expect(p).toContain('https://react.dev/learn');
    expect(p).toContain('书签栏 / 技术');
    expect(p).toContain('[#n]');
    // 必须说清这是「部分列表」，否则模型会以为这就是全部书签
    expect(p).toContain('partial list');
  });

  it('★ 候选为空时明确告知「没找到」，避免模型凭空编造', () => {
    const p = buildQaPrompt('不存在的东西', []);
    expect(p).toContain('NO matches');
    expect(p).toContain('Do not invent');
  });

  it('超长标题/URL 被截断，不让单条候选吃掉整个预算', () => {
    const p = buildQaPrompt('x', [cand({ title: 'T'.repeat(500), url: 'u'.repeat(500) })]);
    expect(p).not.toContain('T'.repeat(200));
    expect(p).toContain('\u2026');
  });
});
