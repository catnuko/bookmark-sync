/**
 * tests/ai/health.test.ts — 健康洞察的本地统计层。
 *
 * 这一层的数字会直接变成卡片上的结论（「你有 N 条沉睡书签」），算错不会报错、
 * 只会误导。所以重点覆盖：空文件夹/散书签的边界、沉睡判定的 URL 规范化
 * （带 utm 的历史必须命中干净的书签 URL）、以及 null（取不到）与 0 的区分。
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SLEEP_DAYS,
  buildHealthPrompt,
  collectHealth,
  healthSuggestions,
  type HealthHistoryAPI,
  type HealthStats,
  type LinkSummary,
} from '../../src/ai/health.js';
import type { ChromeTreeNode } from '../../src/sync/index.js';

/** 与真实树同形：根 → 书签栏 / 其他书签，含空文件夹与一层子文件夹。 */
const tree: ChromeTreeNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: '书签栏',
        parentId: '0',
        children: [
          { id: '10', title: 'A', url: 'https://a.com/x', parentId: '1' },
          { id: '11', title: 'B', url: 'https://b.com/y?utm_source=tw', parentId: '1' },
          { id: '12', title: '空文件夹', parentId: '1' },
          {
            id: '13',
            title: '子文件夹',
            parentId: '1',
            children: [
              // 与 10 规范化后同 URL → 一组重复
              { id: '130', title: 'A (dup)', url: 'https://a.com/x', parentId: '13' },
              { id: '131', title: '深空文件夹', parentId: '13' },
            ],
          },
        ],
      },
      {
        id: '2',
        title: '其他书签',
        parentId: '0',
        children: [
          { id: '20', title: 'D', url: 'https://d.com/z', parentId: '2' },
          {
            id: '21',
            title: '有内容的文件夹',
            parentId: '2',
            children: [{ id: '210', title: 'E', url: 'https://e.com/w', parentId: '21' }],
          },
        ],
      },
    ],
  },
];

/**
 * 可控的假历史。★ 必须按 startTime 过滤 —— 真实 API 就是这么做的，不模拟的话
 * 「窗口外=沉睡」这条逻辑在测试里会假通过（见 countSleeping 的窗口查询）。
 */
function fakeHistory(items: Array<{ url: string; lastVisitTime: number }>): HealthHistoryAPI {
  return {
    search: async (q) => items.filter((it) => it.lastVisitTime >= (q.startTime ?? 0)),
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

const summary: LinkSummary = {
  at: NOW,
  total: 5,
  ok: 2,
  broken: 2,
  redirect: 0,
  changed: 1,
  unknown: 0,
};

describe('collectHealth', () => {
  it('统计总数 / 散书签 / 空文件夹 / 重复，且不重跑探活', async () => {
    const s = await collectHealth(tree, { linkSummary: summary });
    expect(s.total).toBe(5); // 10, 11, 130, 20, 210
    // 直接挂在固定根容器（1 书签栏 / 2 其他书签）下的：10, 11, 20
    expect(s.loose).toBe(3);
    // 12（无子）与 131（无子）—— 13 与 21 子树里有书签，不算空
    expect(s.emptyFolders).toBe(2);
    expect(s.duplicateGroups).toBe(1);
    expect(s.duplicateItems).toBe(1);
    // 失效数字来自摘要，不来自本地探活
    expect(s.broken).toBe(2);
    expect(s.changed).toBe(1);
  });

  it('★ 无历史权限时 sleeping 记 null（不是 0）', async () => {
    const s = await collectHealth(tree, { history: null });
    expect(s.sleeping).toBeNull();
    // 没传摘要时失效也是 null
    expect(s.broken).toBeNull();
    expect(s.changed).toBeNull();
  });

  it('沉睡判定：按规范化 URL 比对，带 utm 的历史能命中干净的书签 URL', async () => {
    const history = fakeHistory([
      // 访问过 a.com/x（带追踪参数）→ 10 与 130 都不算沉睡
      { url: 'https://a.com/x?utm_source=news', lastVisitTime: NOW - 1 * DAY },
      // d.com/z 最后一次访问在 200 天前 → 沉睡
      { url: 'https://d.com/z', lastVisitTime: NOW - 200 * DAY },
    ]);
    const s = await collectHealth(tree, { history, now: NOW });
    // 沉睡：11（从未访问）、20（200 天前）、210（从未访问）
    expect(s.sleeping).toBe(3);
  });

  it('★ 历史查询抛错时降级为 0，不让整页报错', async () => {
    const history: HealthHistoryAPI = {
      search: async () => {
        throw new Error('permission revoked');
      },
    };
    const s = await collectHealth(tree, { history, now: NOW });
    expect(s.sleeping).toBe(0);
  });

  it('sleepDays 可调：阈值内的访问算「近期」，超出即沉睡', async () => {
    const history = fakeHistory([{ url: 'https://d.com/z', lastVisitTime: NOW - 20 * DAY }]);
    // 默认 90 天：d.com/z 属近期 → 沉睡 10 / 11 / 130 / 210 共 4 条
    expect((await collectHealth(tree, { history, now: NOW })).sleeping).toBe(4);
    // 阈值收紧到 15 天：d.com/z（20 天前）转为沉睡 → 5 条
    expect((await collectHealth(tree, { history, now: NOW, sleepDays: 15 })).sleeping).toBe(5);
    expect(DEFAULT_SLEEP_DAYS).toBe(90);
  });
});

describe('healthSuggestions', () => {
  const base: HealthStats = {
    total: 100,
    loose: 0,
    duplicateGroups: 0,
    duplicateItems: 0,
    emptyFolders: 0,
    sleeping: null,
    broken: 0,
    changed: 0,
  };

  it('只给真正有问题的项出建议', () => {
    expect(healthSuggestions(base)).toEqual([]);
  });

  it('未检测失效链接 → 给「去检测」引导，而不是「你有 N 条失效」', () => {
    const rows = healthSuggestions({ ...base, broken: null });
    expect(rows).toHaveLength(1);
    expect(rows[0].titleKey).toBe('hlt_sugCheckTitle');
    expect(rows[0].pane).toBe('links');
  });

  it('各项计数非零时按序出建议，且 pane 指向正确', () => {
    const rows = healthSuggestions({
      ...base,
      loose: 7,
      duplicateGroups: 3,
      duplicateItems: 4,
      emptyFolders: 2,
      broken: 5,
    });
    expect(rows.map((r) => r.titleKey)).toEqual([
      'hlt_sugLooseTitle',
      'hlt_sugDupTitle',
      'hlt_sugBrokenTitle',
      'hlt_sugEmptyTitle',
    ]);
    expect(rows.find((r) => r.titleKey === 'hlt_sugBrokenTitle')?.pane).toBe('links');
    expect(rows.find((r) => r.titleKey === 'hlt_sugLooseTitle')?.pane).toBe('organize');
    // 占位符实参来自统计，别把 undefined 塞进去
    expect(rows.find((r) => r.titleKey === 'hlt_sugDupTitle')?.descSubs).toEqual(['3', '4']);
  });
});

describe('buildHealthPrompt', () => {
  it('null 口径标为 unavailable，避免模型当成 0', () => {
    const p = buildHealthPrompt({
      total: 10,
      loose: 1,
      duplicateGroups: 0,
      duplicateItems: 0,
      emptyFolders: 0,
      sleeping: null,
      broken: null,
      changed: null,
    });
    expect(p).toContain('total bookmarks: 10');
    expect(p).toMatch(/dormant for 90\+ days: unavailable/);
    expect(p).toMatch(/broken links \(404\/410\): unavailable/);
    // 0 的口径必须显示为 0（与 unavailable 区分）
    expect(p).toContain('duplicate groups: 0');
  });
});
