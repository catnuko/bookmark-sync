/**
 * tests/ui-cache.test.ts — 首屏缓存落盘时的「响应式数组」边界。
 *
 * 回归背景（2026-09-29 实测）：`writeUiCache` 直接把 Vue 的 reactive 投影交给
 * `chrome.storage.local`，其中 `spaces` / `devices` 是 **Proxy**。Chrome 的存储
 * 序列化（V8ValueConverter）用 `v8::Value::IsArray()` 判数组，而它对 Proxy 返回
 * false —— 数组被写成 `{"0":{…}}` 数字键对象、空数组写成 `{}`。读回来塞进 state
 * 后，`spaces.find(...)` 直接抛 `TypeError: find is not a function`，把
 * `refreshProfile` 整条链打断。
 *
 * Node 里没法调用真的 V8ValueConverter，但 `util.types.isProxy` 能精确复刻它的
 * 判据，所以这里用一个「Proxy 不算数组」的序列化器当假 storage，忠实重现该行为：
 * 只要落盘前没做 JSON 克隆，测试就会看到对象而不是数组。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive } from 'vue';
import { types } from 'node:util';

let store: Record<string, unknown>;

/** 模拟 Chrome V8ValueConverter：Proxy 不被认作数组（v8::Value::IsArray 不拆 Proxy）。 */
function chromeSerialize(v: unknown): unknown {
  if (types.isProxy(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object)) {
      out[k] = chromeSerialize((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  if (Array.isArray(v)) return v.map(chromeSerialize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = chromeSerialize(val);
    return out;
  }
  return v;
}

function installChrome(): void {
  const local = {
    get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store[k] = chromeSerialize(v);
    },
    remove: async (key: string) => {
      delete store[key];
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = { storage: { local } };
}

/** 每个用例都重装 chrome 并清掉模块缓存——ext.ts 在模块加载时就抓了 globalThis.chrome。 */
async function loadCacheModule() {
  vi.resetModules();
  return import('../src/lib/uiCache.js');
}

beforeEach(() => {
  store = {};
  installChrome();
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('writeUiCache / readUiCache', () => {
  it('把 reactive 投影落盘成真数组（不是 Proxy，也不会变成数字键对象）', async () => {
    const { writeUiCache, readUiCache } = await loadCacheModule();
    // 与 store.persistUiCache 同款：显式对象字面量，数组字段直接来自 reactive state。
    const state = reactive({
      profile: { plan: 'plus', quota_bytes: 1, used_bytes: 0 },
      serverCount: 3,
      spaces: [{ id: 's1', name: 'A' }],
      activeSpace: { id: 's1', name: 'A' },
      boundStale: false,
      devices: [{ device_id: 'd1', name: 'x' }],
    });

    await writeUiCache('u1', {
      profile: state.profile,
      serverCount: state.serverCount,
      spaces: state.spaces,
      activeSpace: state.activeSpace,
      boundStale: state.boundStale,
      devices: state.devices,
    });

    const raw = store['uiCache.v1'] as { data: Record<string, unknown> };
    expect(Array.isArray(raw.data.spaces)).toBe(true);
    expect(Array.isArray(raw.data.devices)).toBe(true);
    expect(types.isProxy(raw.data.spaces)).toBe(false);

    const back = await readUiCache('u1');
    expect(back?.spaces).toEqual([{ id: 's1', name: 'A' }]);
    expect(back?.devices).toEqual([{ device_id: 'd1', name: 'x' }]);
    expect(back?.boundStale).toBe(false);
    // 下游正是这么用的——坏缓存会在这里抛 TypeError。
    expect(back?.spaces.find((s) => s.id === 's1')?.name).toBe('A');
  });

  it('空数组落盘后仍是空数组（不是 {}）', async () => {
    const { writeUiCache, readUiCache } = await loadCacheModule();
    const state = reactive({
      profile: null,
      serverCount: null,
      spaces: [] as { id: string; name: string }[],
      activeSpace: null,
      boundStale: false,
      devices: [] as { device_id: string; name: string }[],
    });

    await writeUiCache('u1', {
      profile: state.profile,
      serverCount: state.serverCount,
      spaces: state.spaces,
      activeSpace: state.activeSpace,
      boundStale: state.boundStale,
      devices: state.devices,
    });

    const raw = store['uiCache.v1'] as { data: Record<string, unknown> };
    expect(Array.isArray(raw.data.spaces)).toBe(true);
    const back = await readUiCache('u1');
    expect(back?.spaces).toEqual([]);
    expect(back?.devices).toEqual([]);
  });

  it('读到历史坏缓存（数字键对象）时按空数组处理，不把坏形状带进 state', async () => {
    const { readUiCache } = await loadCacheModule();
    store['uiCache.v1'] = {
      u: 'u1',
      at: Date.now(),
      data: {
        profile: null,
        serverCount: null,
        spaces: { '0': { id: 's1', name: 'A' } },
        activeSpace: null,
        boundStale: true,
        devices: {},
      },
    };

    const c = await readUiCache('u1');
    expect(c?.spaces).toEqual([]);
    expect(c?.devices).toEqual([]);
    // 非数组字段照常保留：缓存只是优化，坏字段降级、好字段照用。
    expect(c?.boundStale).toBe(true);
    expect(c?.spaces.find(() => true)).toBeUndefined();
  });

  it('账号不符 / 未登录 / 无缓存一律返回 null', async () => {
    const { writeUiCache, readUiCache } = await loadCacheModule();
    await writeUiCache('u1', {
      profile: null,
      serverCount: null,
      spaces: [],
      activeSpace: null,
      boundStale: false,
      devices: [],
    });

    expect(await readUiCache('u2')).toBeNull();
    expect(await readUiCache('')).toBeNull();
    store = {};
    expect(await readUiCache('u1')).toBeNull();
  });
});
