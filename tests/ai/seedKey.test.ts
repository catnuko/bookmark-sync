/**
 * tests/ai/seedKey.test.ts — 本地开发 API Key 的启动预填。
 *
 * 这条路径的失败都是**静默**的：预填不生效只是「设置页要手填」，预填过度生效
 * 却是「用户的配置被开发凭据悄悄改掉」。所以重点覆盖**不该写的情况**：
 *
 *   1. 正式发版（没有注入值）→ 绝不写，否则商店用户的 key 被清掉；
 *   2. 用户已有 key → 绝不覆盖；
 *   3. 用户已有配置（哪怕没 key）→ 绝不覆盖；
 *   4. `enabled` 永远是 false —— 装了扩展不等于授权把书签发出去。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** 记录写入的 storage.local 桩。 */
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
        remove: vi.fn(async (k: string) => {
          delete store[k];
        }),
      },
    },
  };
  g.browser = undefined;
  return { store, g };
}

/**
 * 在模块加载前设置 `__DEV_CREDS__`。config.ts 在顶层读它，所以必须动态 import
 * 才能让注入值生效 —— 静态 import 会被 vite/rollup 提前求值。
 */
async function loadWithDevAiKey(aiKey: string) {
  vi.resetModules();
  (globalThis as unknown as { __DEV_CREDS__?: unknown }).__DEV_CREDS__ = {
    email: '',
    password: '',
    passphrase: '',
    aiKey,
  };
  return import('../../src/ai/config.js');
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  delete (globalThis as unknown as { __DEV_CREDS__?: unknown }).__DEV_CREDS__;
});

describe('seedDevAiKey', () => {
  it('★ 正式发版（无注入值）时什么都不写', async () => {
    const { store } = stubStorage();
    const { seedDevAiKey } = await loadWithDevAiKey('');
    await seedDevAiKey();
    // 商店用户的既有配置必须原样保留，不能被「无注入值」洗掉
    expect(store['ai.apiKey']).toBeUndefined();
    expect(store['ai.config']).toBeUndefined();
  });

  it('★ 用户已有 key 时绝不覆盖', async () => {
    const { store } = stubStorage({ 'ai.apiKey': 'sk-user-own-key' });
    const { seedDevAiKey, readApiKey } = await loadWithDevAiKey('sk-dev-injected');
    await seedDevAiKey();
    expect(await readApiKey()).toBe('sk-user-own-key');
    expect(store['ai.config']).toBeUndefined(); // 也不该顺手写配置
  });

  it('★ 用户已有配置（哪怕没 key）时不覆盖', async () => {
    const { store } = stubStorage({
      'ai.config': {
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4.1-mini',
        enabled: true,
      },
    });
    const { seedDevAiKey, readAiConfig } = await loadWithDevAiKey('sk-dev-injected');
    await seedDevAiKey();
    const cfg = await readAiConfig();
    expect(cfg.provider).toBe('openai');
    expect(cfg.enabled).toBe(true);
    expect(store['ai.apiKey']).toBeUndefined();
  });

  it('空配置时写入注入的 key + deepseek 默认端点', async () => {
    const { store } = stubStorage();
    const { seedDevAiKey, readApiKey, readAiConfig } = await loadWithDevAiKey('sk-dev-abc123');
    await seedDevAiKey();
    expect(await readApiKey()).toBe('sk-dev-abc123');
    const cfg = await readAiConfig();
    expect(cfg.provider).toBe('deepseek');
    expect(cfg.baseUrl).toBe('https://api.deepseek.com');
    expect(cfg.model).toBe('deepseek-chat');
  });

  it('★ enabled 保持 false —— 预填不等于授权', async () => {
    stubStorage();
    const { seedDevAiKey, readAiConfig } = await loadWithDevAiKey('sk-dev-abc123');
    await seedDevAiKey();
    expect((await readAiConfig()).enabled).toBe(false);
  });

  it('幂等：连续调两次结果一致', async () => {
    const { store } = stubStorage();
    const { seedDevAiKey, readApiKey } = await loadWithDevAiKey('sk-dev-abc123');
    await seedDevAiKey();
    await seedDevAiKey();
    expect(await readApiKey()).toBe('sk-dev-abc123');
    expect(store['ai.apiKey']).toBe('sk-dev-abc123');
  });

  it('key 前后空白被 trim', async () => {
    stubStorage();
    const { seedDevAiKey, readApiKey } = await loadWithDevAiKey('  sk-dev-abc123  ');
    await seedDevAiKey();
    expect(await readApiKey()).toBe('sk-dev-abc123');
  });

  it('storage 抛异常时静默失败（设置页仍可手填）', async () => {
    const g = globalThis as unknown as {
      chrome?: { storage: { local: Record<string, unknown> } };
    };
    g.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error('storage unavailable');
          }),
          set: vi.fn(),
          remove: vi.fn(),
        },
      },
    };
    const { seedDevAiKey } = await loadWithDevAiKey('sk-dev-abc123');
    await expect(seedDevAiKey()).resolves.toBeUndefined();
  });
});
