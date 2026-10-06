/**
 * tests/ai/providerList.test.ts — 多 provider 列表与旧结构迁移。
 *
 * ## 为什么这些用例的形状很重要
 *
 * 1. **迁移只做一次且不删老键** —— 已填的 key 是用户花了心思设的，丢一次就是
 *    「这产品不靠谱」。所以断言的是「老键还在」，不是「老键没了」。
 * 2. **id 不能用厂商名** —— 用户要能同时配「DeepSeek 官方」与「DeepSeek 中转」，
 *    用厂商名当 key 会互相覆盖。
 * 3. **activeId 指向不存在的条目时要兜底** —— 否则用户删掉选中项后 AI 彻底不可用。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

function stubStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const g = globalThis as unknown as { chrome?: unknown; browser?: unknown };
  g.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (keys === undefined) return { ...store };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in store) out[k] = store[k];
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
        }),
      },
    },
  };
  g.browser = undefined;
  return { store };
}

async function load() {
  vi.resetModules();
  return import('../../src/ai/config.js');
}

beforeEach(() => {
  stubStorage();
});

describe('provider 列表 CRUD', () => {
  it('addProvider 套用厂商默认值并切过去', async () => {
    const { store } = stubStorage();
    const { addProvider, readProviders, readActiveId } = await load();
    const e = await addProvider('deepseek');
    expect(e.provider).toBe('deepseek');
    expect(e.baseUrl).toBe('https://api.deepseek.com');
    expect(e.model).toBe('deepseek-v4-flash');
    expect(await readActiveId()).toBe(e.id);
    expect((await readProviders()).length).toBe(1);
    expect(store['ai.providers']).toHaveLength(1);
  });

  it('★ 同一个厂商可以加两条（id 不冲突）', async () => {
    stubStorage();
    const { addProvider, readProviders } = await load();
    const a = await addProvider('deepseek');
    const b = await addProvider('deepseek');
    expect(a.id).not.toBe(b.id);
    const list = await readProviders();
    expect(list).toHaveLength(2);
    // 两条的端点相同但 id 不同 → 各自可以挂不同的 key
    expect(list[0].baseUrl).toBe(list[1].baseUrl);
  });

  it('updateProvider 逐字段打补丁，不影响其他条目', async () => {
    stubStorage();
    const { addProvider, updateProvider, readProviders } = await load();
    const a = await addProvider('openai');
    const b = await addProvider('deepseek');
    await updateProvider(a.id, { model: 'gpt-4o' });
    const list = await readProviders();
    expect(list.find((e) => e.id === a.id)?.model).toBe('gpt-4o');
    expect(list.find((e) => e.id === b.id)?.model).toBe('deepseek-v4-flash');
  });

  it('updateProvider 对不存在的 id 静默忽略（UI/存储竞态）', async () => {
    const { store } = stubStorage({
      'ai.providers': [
        { id: 'p_1', provider: 'openai', label: 'A', baseUrl: 'https://a', model: 'm' },
      ],
    });
    const { updateProvider, readProviders } = await load();
    await updateProvider('nope', { model: 'x' });
    expect((await readProviders())[0].model).toBe('m');
    expect(store['ai.providers']).toHaveLength(1);
  });

  it('★ removeProvider 连带删掉它的 key', async () => {
    stubStorage();
    const { addProvider, writeAllKeys, readAllKeys, removeProvider, readProviders } = await load();
    const a = await addProvider('openai');
    const b = await addProvider('deepseek');
    await writeAllKeys({ [a.id]: 'sk-a', [b.id]: 'sk-b' });
    await removeProvider(a.id);
    expect(await readAllKeys()).toEqual({ [b.id]: 'sk-b' }); // a 的 key 不能留成孤儿
    expect((await readProviders()).length).toBe(1);
  });

  it('★ activeId 指向已删条目时兜底到第一条（AI 不至于彻底不可用）', async () => {
    const { store } = stubStorage({
      'ai.providers': [
        { id: 'p_1', provider: 'openai', label: 'A', baseUrl: 'https://a', model: 'm' },
        { id: 'p_2', provider: 'deepseek', label: 'D', baseUrl: 'https://d', model: 'm' },
      ],
      'ai.activeId': 'p_1',
    });
    const { removeProvider, readAiConfig } = await load();
    await removeProvider('p_1');
    // activeId 仍指向已删的 p_1 → readAiConfig 应回落到 p_2
    const cfg = await readAiConfig();
    expect(cfg.provider).toBe('deepseek');
    expect(store['ai.activeId']).toBe('p_1'); // 没被动过（兜底在读取侧）
  });

  it('列表为空时 readAiConfig 返回 deepseek 默认值且 enabled=false', async () => {
    stubStorage();
    const { readAiConfig } = await load();
    const cfg = await readAiConfig();
    expect(cfg.provider).toBe('deepseek');
    expect(cfg.enabled).toBe(false);
  });

  it('坏数据（条目缺字段 / 非数组）被归一化，不抛穿', async () => {
    stubStorage({ 'ai.providers': 'garbage', 'ai.keys': 'garbage' });
    const { readProviders, readAllKeys } = await load();
    expect(await readProviders()).toEqual([]);
    expect(await readAllKeys()).toEqual({});
  });

  it('重复 id 的条目只保留第一个', async () => {
    stubStorage({
      'ai.providers': [
        { id: 'p_1', provider: 'openai', label: 'first', baseUrl: 'https://a', model: 'm' },
        { id: 'p_1', provider: 'deepseek', label: 'second', baseUrl: 'https://d', model: 'm' },
      ],
    });
    const { readProviders } = await load();
    const list = await readProviders();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('first');
  });
});

describe('key 与配置分开存', () => {
  it('writeAllKeys 丢掉空串与空白项', async () => {
    stubStorage();
    const { writeAllKeys, readAllKeys } = await load();
    await writeAllKeys({ a: 'sk-a', b: '', c: '   ', d: ' sk-d ' });
    expect(await readAllKeys()).toEqual({ a: 'sk-a', d: 'sk-d' });
  });

  it('★ 预填的 key 落在 ai.keys，不在 ai.providers 条目里', async () => {
    stubStorage();
    const { addProvider, writeAllKeys, readProviders, readAllKeys } = await load();
    const e = await addProvider('deepseek');
    await writeAllKeys({ [e.id]: 'sk-x' });
    const [entry] = await readProviders();
    // 条目对象里不能有任何 key 字段 —— 否则「导出配置不带 key」这个不变式就破了
    expect(Object.keys(entry).sort()).toEqual(['baseUrl', 'id', 'label', 'model', 'provider']);
    expect(JSON.stringify(entry)).not.toContain('sk-x');
    expect(await readAllKeys()).toEqual({ [e.id]: 'sk-x' });
  });

  it('readApiKey / writeApiKey 作用于当前生效条目', async () => {
    stubStorage();
    const { addProvider, setActiveProvider, readApiKey, writeApiKey, readAllKeys } = await load();
    const a = await addProvider('openai');
    const b = await addProvider('deepseek');
    await setActiveProvider(b.id);
    await writeApiKey('sk-b-key');
    expect(await readApiKey()).toBe('sk-b-key');
    expect(await readAllKeys()).toEqual({ [b.id]: 'sk-b-key' });
    // 切回 a：a 没 key
    await setActiveProvider(a.id);
    expect(await readApiKey()).toBe('');
  });
});

describe('isAiReady', () => {
  it('开关关 → 未就绪', async () => {
    stubStorage();
    const { addProvider, writeAllKeys, isAiReady } = await load();
    const e = await addProvider('deepseek');
    await writeAllKeys({ [e.id]: 'sk-x' });
    expect(await isAiReady()).toBe(false); // enabled 默认 false
  });

  it('开关开 + 当前条目有 key → 就绪', async () => {
    stubStorage();
    const { addProvider, writeAllKeys, setEnabled, isAiReady } = await load();
    const e = await addProvider('deepseek');
    await writeAllKeys({ [e.id]: 'sk-x' });
    await setEnabled(true);
    expect(await isAiReady()).toBe(true);
  });

  it('开关开但没 key → 未就绪（别让用户对着一个跑不通的 AI 点问答）', async () => {
    stubStorage();
    const { addProvider, setEnabled, isAiReady } = await load();
    await addProvider('deepseek');
    await setEnabled(true);
    expect(await isAiReady()).toBe(false);
  });
});

describe('旧结构迁移', () => {
  const LEGACY = {
    'ai.config': {
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4.1-mini',
      enabled: true,
    },
    'ai.apiKey': 'sk-legacy-user-key',
  };

  it('★ 旧结构迁进列表，且 key 跟着走', async () => {
    const { store } = stubStorage(LEGACY);
    const { migrateLegacy, readProviders, readApiKey, readEnabled, readAiConfig } = await load();
    await migrateLegacy();
    const list = await readProviders();
    expect(list).toHaveLength(1);
    expect(list[0].provider).toBe('openai');
    expect(list[0].model).toBe('gpt-4.1-mini');
    expect(await readApiKey()).toBe('sk-legacy-user-key');
    expect(await readEnabled()).toBe(true);
    expect((await readAiConfig()).model).toBe('gpt-4.1-mini');
    expect(store['ai.migrated']).toMatchObject({ done: true, enabled: true });
  });

  it('★ 不删老键（新代码有 bug 回滚时用户配置还在）', async () => {
    const { store } = stubStorage(LEGACY);
    const { migrateLegacy } = await load();
    await migrateLegacy();
    expect(store['ai.config']).toBeDefined();
    expect(store['ai.apiKey']).toBe('sk-legacy-user-key');
  });

  it('幂等：跑两次不会变成两条', async () => {
    stubStorage(LEGACY);
    const { migrateLegacy, readProviders } = await load();
    await migrateLegacy();
    await migrateLegacy();
    expect(await readProviders()).toHaveLength(1);
  });

  it('全新用户（无旧配置）只打标记，不建空条目', async () => {
    const { store } = stubStorage();
    const { migrateLegacy, readProviders } = await load();
    await migrateLegacy();
    expect(await readProviders()).toEqual([]);
    expect(store['ai.migrated']).toMatchObject({ done: true, enabled: false });
    expect(store['ai.providers']).toBeUndefined(); // 不该写空数组
  });

  it('★ 用户已用新 UI 建过条目时，只补标记不覆盖他的配置', async () => {
    const { store } = stubStorage({
      ...LEGACY,
      'ai.providers': [
        {
          id: 'p_user',
          provider: 'deepseek',
          label: '我的',
          baseUrl: 'https://my.proxy',
          model: 'my-model',
        },
      ],
      'ai.activeId': 'p_user',
    });
    const { migrateLegacy, readProviders, readAiConfig } = await load();
    await migrateLegacy();
    const list = await readProviders();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p_user');
    expect(list[0].baseUrl).toBe('https://my.proxy'); // 旧配置不能覆盖新的
    expect((await readAiConfig()).baseUrl).toBe('https://my.proxy');
  });

  it('旧结构 enabled=true 会被带走', async () => {
    stubStorage(LEGACY);
    const { migrateLegacy, readEnabled } = await load();
    await migrateLegacy();
    expect(await readEnabled()).toBe(true);
  });
});

describe('clearAi', () => {
  it('清掉列表、key、开关与老结构', async () => {
    const { store } = stubStorage({
      'ai.providers': [
        { id: 'p_1', provider: 'openai', label: 'A', baseUrl: 'https://a', model: 'm' },
      ],
      'ai.keys': { p_1: 'sk-x' },
      'ai.activeId': 'p_1',
      'ai.config': { provider: 'openai', enabled: true },
      'ai.apiKey': 'sk-y',
    });
    const { clearAi, readProviders, readAllKeys } = await load();
    await clearAi();
    expect(await readProviders()).toEqual([]);
    expect(await readAllKeys()).toEqual({});
    expect(store['ai.providers']).toBeUndefined();
    expect(store['ai.apiKey']).toBeUndefined(); // 老结构也清
    expect(store['ai.config']).toBeUndefined();
  });
});
