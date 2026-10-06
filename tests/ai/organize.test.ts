/**
 * tests/ai/organize.test.ts — 归类方案生成与落地。
 *
 * ## 重点测什么
 *
 * 落地层会**真的改用户书签树**，而本项目已有两次「插件删用户数据」的事故
 * （removeTrashedNodes 全量真删 / 本机删除经 pendingRemoved 变成云端墓碑）。
 * 所以这里的测试重心是三条护栏：
 *
 *   1. **永不删除**：apply 期间 fake chrome 上任何 remove* 调用都让测试失败；
 *   2. **建文件夹只在选定范围内**：绝不建在浏览器根下（CRDT 脏 op 的成因）；
 *   3. **可撤销**：apply 前存了位置快照，revert 能把节点移回原位。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChromeTreeNode } from '../../src/sync/index.js';

/**
 * ★ 必须用 vi.mock 工厂替换整个 provider 模块，不能用 vi.spyOn(provider, 'complete')。
 * ESM 命名导出不可重绑定，classify.ts 在模块加载时就把 complete 的引用抓走了 ——
 * spyOn 会静默不生效，表现为「模型返回什么都没吃到」，排查起来很费时间。
 */
const completeMock = vi.fn();
vi.mock('../../src/ai/provider.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/ai/provider.js')>(
    '../../src/ai/provider.js',
  );
  return { ...actual, complete: (...args: unknown[]) => completeMock(...args) };
});

const { applyPlan, listFolders, planOrganize, revertApply } =
  await import('../../src/ai/organize.js');
type OrganizeBookmarksAPI = import('../../src/ai/organize.js').OrganizeBookmarksAPI;

/** 记录一切写操作的 fake chrome。任何 remove 调用都会被 tests 断言到。 */
function makeFake(initial: ChromeTreeNode[]) {
  const calls: Array<{ op: string; args: unknown }> = [];
  let seq = 1000;

  const api: OrganizeBookmarksAPI = {
    getTree: vi.fn(async () => initial),
    move: vi.fn(async (id: string, dest: { parentId: string; index?: number }) => {
      calls.push({ op: 'move', args: { id, dest } });
    }),
    create: vi.fn(async (props: { parentId: string; title: string }) => {
      calls.push({ op: 'create', args: props });
      return { id: `new${seq++}` };
    }),
  };

  // 任何删除类调用都不该出现在本模块里。挂上去是为了让「真的调了」立刻炸出来。
  const forbidden = ['remove', 'removeTree', 'removeChildren'] as const;
  for (const m of forbidden) {
    (api as unknown as Record<string, unknown>)[m] = vi.fn((...a: unknown[]) => {
      calls.push({ op: m, args: a });
      throw new Error(`FORBIDDEN: organize.ts must never call ${m}()`);
    });
  }

  return { api, calls };
}

/**
 * 树：浏览器根 → 书签栏 / 其他书签。
 *
 * 复用候选「前端」是范围「杂货」的**子**文件夹 —— 这正是 planOrganize 的复用边界：
 * 只在选定范围的下一层找，不动范围外的结构。
 *
 * ★ 每个节点都带 `parentId`：真实 `chrome.bookmarks.getTree()` 一定返回它，
 * 而撤销快照靠它还原位置。测试树省略它会让 revert 拿到空快照却不报错（假绿）。
 */
function sampleTree(): ChromeTreeNode[] {
  return [
    {
      id: '0',
      parentId: undefined,
      title: '',
      children: [
        {
          id: '1',
          parentId: '0',
          title: '书签栏',
          children: [
            {
              id: '10',
              parentId: '1',
              title: '杂货',
              children: [
                {
                  id: '100',
                  parentId: '10',
                  index: 0,
                  title: 'Vue 文档',
                  url: 'https://vuejs.org',
                },
                {
                  id: '101',
                  parentId: '10',
                  index: 1,
                  title: 'Rust 书',
                  url: 'https://doc.rust-lang.org',
                },
                {
                  id: '102',
                  parentId: '10',
                  index: 2,
                  title: '红烧肉',
                  url: 'https://example.com/r',
                },
                {
                  id: '11',
                  parentId: '10',
                  index: 3,
                  title: '前端',
                  children: [
                    { id: '110', parentId: '11', index: 0, title: '旧', url: 'https://old.dev' },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: '2',
          parentId: '0',
          title: '其他书签',
          children: [{ id: '20', parentId: '2', index: 0, title: '空文件夹', children: [] }],
        },
      ],
    },
  ];
}

const CFG = { provider: 'anthropic' as const, baseUrl: 'x', model: 'm' };

describe('listFolders', () => {
  it('只列落地根下的文件夹，浏览器根与固定根本身都不出现', async () => {
    const { api } = makeFake(sampleTree());
    const folders = await listFolders(api);
    expect(folders.map((f) => f.id).sort()).toEqual(['10', '11', '20']);
    // 「0」= 浏览器根 —— 挂文件夹进去会产生 parent=ROOT_UUID 的脏 op
    expect(folders.map((f) => f.id)).not.toContain('0');
    // 「1」「2」= 固定根本身，不是可整理的范围（且必须只出现一次，不能被遍历两次）
    expect(folders.map((f) => f.id)).not.toContain('1');
    expect(folders.map((f) => f.id)).not.toContain('2');
  });

  it('looseCount 只数直接子书签，不递归', async () => {
    const { api } = makeFake(sampleTree());
    const folders = await listFolders(api);
    expect(folders.find((f) => f.id === '10')?.looseCount).toBe(3);
  });

  it('书签节点不会被当成文件夹', async () => {
    const { api } = makeFake(sampleTree());
    const folders = await listFolders(api);
    expect(folders.some((f) => f.id === '100')).toBe(false);
  });
});

describe('planOrganize', () => {
  beforeEach(() => {
    completeMock.mockReset();
  });

  it('同名文件夹判定为 reuse，其余为 create', async () => {
    const { api } = makeFake(sampleTree());
    completeMock.mockResolvedValue({
      text: JSON.stringify({
        groups: [
          { folder: '前端', ids: [0] }, // 已有同名子文件夹 → reuse
          { folder: '后端', ids: [1, 2] }, // 无 → create
        ],
      }),
      usage: { input: 100, output: 20 },
    });

    const plan = await planOrganize(api, CFG, 'key', '10');
    expect(plan.groups).toHaveLength(2);
    const [reuse, create] = plan.groups;
    expect(reuse.kind).toBe('reuse');
    expect(reuse.targetId).toBe('11');
    expect(reuse.items).toHaveLength(1);
    expect(create.kind).toBe('create');
    expect(create.targetId).toBeUndefined();
    expect(create.items).toHaveLength(2);
    expect(plan.usage).toEqual({ input: 100, output: 20 });
  });

  it('范围为空（无散书签）时不调模型', async () => {
    const { api } = makeFake(sampleTree());
    const plan = await planOrganize(api, CFG, 'key', '20');
    expect(plan.total).toBe(0);
    expect(plan.groups).toEqual([]);
    expect(completeMock).not.toHaveBeenCalled();
  });

  it('子文件夹里的书签不参与归类', async () => {
    const { api } = makeFake(sampleTree());
    completeMock.mockResolvedValue({
      text: JSON.stringify({ groups: [{ folder: 'X', ids: [0, 1, 2] }] }),
    });
    const plan = await planOrganize(api, CFG, 'key', '10');
    // 范围 10 下只有 100/101/102 三个散书签；110 在子文件夹 11 里
    expect(plan.total).toBe(3);
    expect(plan.groups[0].items.map((i) => i.id).sort()).toEqual(['100', '101', '102']);
  });

  it('★ 把已有子文件夹名喂给模型（引导复用而非造同义新名）', async () => {
    const { api } = makeFake(sampleTree());
    completeMock.mockResolvedValue({
      text: JSON.stringify({ groups: [{ folder: 'X', ids: [0] }] }),
    });
    await planOrganize(api, CFG, 'key', '10');
    const prompt = completeMock.mock.calls[0][2].messages[0].content as string;
    expect(prompt).toContain('前端');
    expect(prompt).toContain('Reuse these existing folder names');
  });

  it('模型返回的下标越界时丢弃（不写进方案）', async () => {
    const { api } = makeFake(sampleTree());
    completeMock.mockResolvedValue({
      text: JSON.stringify({ groups: [{ folder: 'X', ids: [0, 99] }] }),
    });
    const plan = await planOrganize(api, CFG, 'key', '10');
    expect(plan.groups[0].items.map((i) => i.id)).toEqual(['100']);
    expect(plan.unclassified).toHaveLength(2); // 101/102 归不了类，保持原位
  });

  it('范围是书签而非文件夹时报错', async () => {
    const { api } = makeFake(sampleTree());
    await expect(planOrganize(api, CFG, 'key', '100')).rejects.toThrow(/must be a folder/);
  });
});

describe('applyPlan — 护栏', () => {
  const plan = {
    scopeId: '10',
    scopeTitle: '杂货',
    total: 2,
    groups: [
      {
        key: 'g0',
        folder: '前端',
        kind: 'reuse' as const,
        targetId: '11',
        items: [{ id: '100', title: 'a', url: 'https://a' }],
      },
      {
        key: 'g1',
        folder: '后端',
        kind: 'create' as const,
        items: [{ id: '101', title: 'b', url: 'https://b' }],
      },
    ],
    unclassified: [],
  };

  it('★ 全程不调用任何 remove 类 API', async () => {
    const { api, calls } = makeFake(sampleTree());
    await applyPlan(api, plan, ['g0', 'g1']);
    expect(calls.filter((c) => c.op.startsWith('remove'))).toEqual([]);
  });

  it('★ 新建文件夹建在选定范围下，绝不建在浏览器根', async () => {
    const { api, calls } = makeFake(sampleTree());
    await applyPlan(api, plan, ['g1']);
    const created = calls.find((c) => c.op === 'create');
    expect(created).toBeDefined();
    const { parentId } = created!.args as { parentId: string };
    expect(parentId).toBe('10');
    expect(parentId).not.toBe('0');
  });

  it('只应用勾选的组', async () => {
    const { api, calls } = makeFake(sampleTree());
    const r = await applyPlan(api, plan, ['g0']);
    expect(r.movedCount).toBe(1);
    expect(calls.filter((c) => c.op === 'create')).toEqual([]); // g1 未勾选 → 不建
  });

  it('未勾选任何组时什么都不做', async () => {
    const { api, calls } = makeFake(sampleTree());
    const r = await applyPlan(api, plan, []);
    expect(r.movedCount).toBe(0);
    expect(calls).toEqual([]);
  });

  it('复用组不建新文件夹', async () => {
    const { api, calls } = makeFake(sampleTree());
    await applyPlan(api, plan, ['g0']);
    expect(calls.filter((c) => c.op === 'create')).toEqual([]);
    expect(calls.find((c) => c.op === 'move')?.args).toEqual({
      id: '100',
      dest: { parentId: '11' },
    });
  });

  it('建文件夹失败时该组不移动（不猜目标）', async () => {
    const { api, calls } = makeFake(sampleTree());
    (api.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const r = await applyPlan(api, plan, ['g1']);
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'move')).toEqual([]);
  });

  it('单条 move 失败不影响其余条目', async () => {
    const { api } = makeFake(sampleTree());
    (api.move as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);
    const r = await applyPlan(api, plan, ['g0', 'g1']);
    expect(r.movedCount).toBe(1);
    expect(r.failures).toHaveLength(1);
  });

  it('超过单次上限直接拒绝，不静默截断', async () => {
    const many = {
      ...plan,
      groups: [
        {
          key: 'g0',
          folder: 'X',
          kind: 'create' as const,
          items: Array.from({ length: 201 }, (_, i) => ({
            id: `n${i}`,
            title: 't',
            url: 'https://x',
          })),
        },
      ],
    };
    const { api } = makeFake(sampleTree());
    await expect(applyPlan(api, many, ['g0'])).rejects.toThrow(/too many moves/);
  });

  it('shouldStop 中途中断，已完成部分保留', async () => {
    const { api, calls } = makeFake(sampleTree());
    let moves = 0;
    // 只在「真的发生了一次 move 之后」才叫停 —— 这样测的是移动阶段的中断，
    // 而不是第一阶段就把整个流程掐掉（那会让断言变成「什么都没做」）。
    const stop = () => moves > 0;
    const wrapped = {
      ...api,
      move: async (id: string, dest: { parentId: string }) => {
        moves += 1;
        return api.move(id, dest);
      },
    };
    const r = await applyPlan(wrapped, plan, ['g0', 'g1'], undefined, stop);
    expect(r.movedCount).toBe(1); // 第一次 move 做完，第二次被掐断
    expect(calls.filter((c) => c.op === 'move')).toHaveLength(1);
  });

  it('onProgress 汇报进度', async () => {
    const { api } = makeFake(sampleTree());
    const seen: number[] = [];
    await applyPlan(api, plan, ['g0', 'g1'], (d) => seen.push(d));
    expect(seen).toEqual([1, 2]);
  });
});

describe('revertApply — 撤销', () => {
  it('把节点移回原位，且不删新建的文件夹', async () => {
    const { api, calls } = makeFake(sampleTree());
    const r = await applyPlan(
      api,
      {
        scopeId: '10',
        scopeTitle: 's',
        total: 1,
        groups: [
          {
            key: 'g0',
            folder: 'N',
            kind: 'create',
            items: [{ id: '101', title: 'b', url: 'https://b' }],
          },
        ],
        unclassified: [],
      },
      ['g0'],
    );
    expect(r.movedCount).toBe(1);
    expect(r.snapshot.createdFolders).toHaveLength(1);

    calls.length = 0;
    const rev = await revertApply(api, r.snapshot);
    expect(rev.reverted).toBe(1);
    // 101 原本 parent=10 index=1
    expect(calls[0].args).toEqual({ id: '101', dest: { parentId: '10', index: 1 } });
    // ★ 不删新建的文件夹
    expect(calls.filter((c) => c.op.startsWith('remove'))).toEqual([]);
  });

  it('空快照时无事发生', async () => {
    const { api, calls } = makeFake(sampleTree());
    const r = await revertApply(api, { moved: [], createdFolders: [] });
    expect(r.reverted).toBe(0);
    expect(calls).toEqual([]);
  });
});
