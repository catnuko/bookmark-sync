/**
 * src/ai/config.ts — AI 配置的落盘与读取（多 provider 列表）。
 *
 * ## 存哪
 *
 * 统一走 `chrome.storage.local`（经 lib/ext.ts 的 `api.storage`）。**不进
 * `chrome.storage.sync`** —— 那会跟着用户账号漫游到其它设备，等于把 API Key
 * 复制到每一台机器上。BYOK 的前提是「只有我这台机器知道这个 key」。
 *
 * 这与 sync/keyManager.ts 的口令我方一致：两者都只落 local，从不漫游。
 *
 * ## 存什么：多条 provider（2026-10-06 起）
 *
 * 早期是单条：一个 `ai.config` 对象 + 一个 `ai.apiKey`，UI 是一个下拉框。
 * 问题是**填第二个就覆盖第一个** —— 用户同时用 DeepSeek 测效果、用 Ollama
 * 跑本地模型时只能反复重填。
 *
 * 现在是列表：
 *   `ai.providers` → `ProviderEntry[]`，含各自独立的 baseUrl / model
 *   `ai.keys`      → `{[id]: key}` 映射，**与配置分开存**
 *   `ai.activeId`  → 当前选中的条目 id
 *
 * 每条自带 key 是刻意的：厂商不同则 key 不同，混用必然出错。
 *
 * ## ★ 为什么 key 与配置分开存
 *
 * 两个理由，都是将来才会兑现的：
 *  1. 导出/诊断时可以把 `ai.providers` 整个 dump 出来而**不带任何 key**；
 *  2. 将来若要把「哪些厂商配过」这类非敏感信息同步到别的设备，
 *     不会顺手把 key 一起带走。
 *
 * ## 迁移
 *
 * 老结构（`ai.config` + `ai.apiKey`）**读时一次性迁进列表**并打标记
 * （`ai.migrated`）。迁移幂等，且**不删除老键** —— 万一新代码有 bug 回滚，
 * 老配置还在，用户不会丢 key。
 *
 * ## 读写的形状
 *
 * 每个键存一个 JSON 值，而不是散成多个键：避免半写状态（改了 provider 没改
 * model 之类）。读时逐字段归一化，坏数据不抛穿 —— 拿不到配置就当「未配置」，
 * UI 走空态。
 */

import { api } from '../lib/ext.js';
import { PROVIDER_DEFAULTS, type AiConfig, type AiProvider } from './provider.js';

const CONFIG_KEY = 'ai.config'; // 旧结构，迁移来源
const SECRET_KEY = 'ai.apiKey'; // 旧结构，迁移来源
const LIST_KEY = 'ai.providers';
const KEYS_KEY = 'ai.keys';
const ACTIVE_KEY = 'ai.activeId';
const MIGRATED_KEY = 'ai.migrated';

const PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'deepseek', 'custom'];

/**
 * 列表里的一条 provider 配置。
 *
 * `id` 是本地生成的稳定标识，**不是**厂商名 —— 用户可以加两个 DeepSeek
 * （一个官方、一个中转），用厂商名当 key 会互相覆盖。
 */
export interface ProviderEntry extends AiConfig {
  /** 本地稳定 id，格式 `p_` + 随机串。 */
  id: string;
  /**
   * 用户给这条起的名字。默认等于厂商 label，但可改 —— 「官方」与「中转」
   * 两条同厂商的条目靠这个区分。
   */
  label: string;
}

function isProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function newId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}`;
}

/** 归一化一条 provider 条目。逐字段兜底，坏值退回该厂商默认值。 */
function normalizeEntry(raw: unknown): ProviderEntry {
  const o = (raw ?? {}) as Partial<ProviderEntry>;
  const provider = isProvider(o.provider) ? o.provider : 'custom';
  const d = PROVIDER_DEFAULTS[provider];
  return {
    id: str(o.id, newId()),
    provider,
    label: str(o.label, d.label),
    baseUrl: str(o.baseUrl, d.baseUrl),
    model: str(o.model, d.model),
  };
}

/** 归一化列表：非数组 → 空数组；逐条兜底；丢掉 id 重复的条目（后者覆盖前者）。 */
function normalizeList(raw: unknown): ProviderEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProviderEntry[] = [];
  for (const r of raw) {
    const e = normalizeEntry(r);
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function normalizeKeys(raw: unknown): Record<string, string> {
  // ★ 必须先卡「是不是真对象」：Object.entries('garbage') 会返回
  // {0:'g',1:'a',2:'r',...} —— 一条被写坏的 ai.keys 字符串会被当成 7 个 key，
  // 用户切到对应条目时就会莫名填进 'g'/'a' 这种单字符 key。
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

// ---------------------------------------------------------------- 列表读写

/** 读全部 provider 条目（含各自的 baseUrl/model，**不含 key**）。 */
export async function readProviders(): Promise<ProviderEntry[]> {
  try {
    const got = await api.storage.local.get(LIST_KEY);
    return normalizeList(got[LIST_KEY]);
  } catch {
    return [];
  }
}

/** 读 key 映射（`{[id]: key}`）。 */
export async function readAllKeys(): Promise<Record<string, string>> {
  try {
    const got = await api.storage.local.get(KEYS_KEY);
    return normalizeKeys(got[KEYS_KEY]);
  } catch {
    return {};
  }
}

/** 当前选中的条目 id。列表为空时返回空串。 */
export async function readActiveId(): Promise<string> {
  try {
    const got = await api.storage.local.get(ACTIVE_KEY);
    return str(got[ACTIVE_KEY], '');
  } catch {
    return '';
  }
}

/** 总开关。独立于列表存在（没有任何 provider 时也能记住用户的选择）。 */
export async function readEnabled(): Promise<boolean> {
  try {
    const got = (await api.storage.local.get(MIGRATED_KEY)) as Record<
      string,
      { enabled?: unknown }
    >;
    return got[MIGRATED_KEY]?.enabled === true;
  } catch {
    return false;
  }
}

/** AI 是否已就绪：总开关开着、且当前条目有 key。 */
export async function isAiReady(): Promise<boolean> {
  const [enabled, list, activeId, keys] = await Promise.all([
    readEnabled(),
    readProviders(),
    readActiveId(),
    readAllKeys(),
  ]);
  const id = pickActiveId(list, activeId);
  return enabled && !!id && !!keys[id];
}

/**
 * 挑出该用哪一条。
 *
 * 优先 `activeId`；它不在列表里（被删了/迁移残留）时退回第一条 —— 宁可
 * 用一个已存在的条目，也不要「一个都选不出来」导致 AI 彻底不可用。
 */
function pickActiveId(list: ProviderEntry[], activeId: string): string {
  if (list.length === 0) return '';
  return list.some((e) => e.id === activeId) ? activeId : list[0].id;
}

// ------------------------------------------------------- 旧接口（保持签名不变）

/**
 * 读「当前生效」的完整配置。
 *
 * 签名保留是为了让 ChatPanel / PaneOrganize 等调用方不用改 —— 它们只关心
 * 「现在该用哪个端点」，不关心列表长什么样。
 */
export async function readAiConfig(): Promise<StoredAiConfig> {
  const [list, activeId] = await Promise.all([readProviders(), readActiveId()]);
  const id = pickActiveId(list, activeId);
  const entry = list.find((e) => e.id === id);
  if (!entry) {
    return {
      provider: 'deepseek',
      baseUrl: PROVIDER_DEFAULTS.deepseek.baseUrl,
      model: PROVIDER_DEFAULTS.deepseek.model,
      enabled: false,
    };
  }
  return { ...entry, enabled: await readEnabled() };
}

/** 从配置读出的完整配置：不含 key（key 要单独取，见 readApiKey）。 */
export interface StoredAiConfig extends AiConfig {
  /** 用户是否显式启用了 AI。总开关，默认关 —— 装了扩展不等于授权发数据。 */
  enabled: boolean;
}

/** 读当前生效条目的 key。没有可用条目或没填返回空串。 */
export async function readApiKey(): Promise<string> {
  const [list, activeId, keys] = await Promise.all([
    readProviders(),
    readActiveId(),
    readAllKeys(),
  ]);
  const id = pickActiveId(list, activeId);
  return id ? (keys[id] ?? '') : '';
}

/**
 * 写 key 映射（整体覆盖）。
 *
 * 供设置页保存时使用：UI 手上有一份 `{[id]: key}` 草稿（key 在输入框里），
 * 不想为「改一个值」先删后建两趟。仍走 config.ts 而不是让 UI 直接碰
 * `api.storage.local` —— key 的存储位置是这个模块的不变式，散出去就没人守了。
 */
export async function writeAllKeys(keys: Record<string, string>): Promise<void> {
  await api.storage.local.set({ [KEYS_KEY]: normalizeKeys(keys) });
}

/** 写当前生效条目的 key。 */
export async function writeApiKey(key: string): Promise<void> {
  const [list, activeId, keys] = await Promise.all([
    readProviders(),
    readActiveId(),
    readAllKeys(),
  ]);
  const id = pickActiveId(list, activeId);
  if (!id) return; // 没有任何条目时无处可写（UI 应先让用户加一条）
  if (!key.trim()) {
    delete keys[id];
  } else {
    keys[id] = key.trim();
  }
  await api.storage.local.set({ [KEYS_KEY]: keys });
}

// ------------------------------------------------------------------ 列表操作

/** 新增一条。厂商给定时套用其默认端点/模型，否则给 custom 空壳。 */
export async function addProvider(provider?: AiProvider): Promise<ProviderEntry> {
  const p = provider ?? 'custom';
  const d = PROVIDER_DEFAULTS[p];
  const entry: ProviderEntry = {
    id: newId(),
    provider: p,
    label: d.label,
    baseUrl: d.baseUrl,
    model: d.model,
  };
  const list = await readProviders();
  await api.storage.local.set({
    [LIST_KEY]: [...list, entry],
    [ACTIVE_KEY]: entry.id, // 新加的直接切过去，否则用户加完还要再点一下
  });
  return entry;
}

/** 改一条。**id 不存在时静默忽略** —— UI 与存储之间可能有一次竞态（删了又改）。 */
export async function updateProvider(
  id: string,
  patch: Partial<Omit<ProviderEntry, 'id'>>,
): Promise<void> {
  const list = await readProviders();
  if (!list.some((e) => e.id === id)) return;
  const next = list.map((e) => (e.id === id ? normalizeEntry({ ...e, ...patch, id }) : e));
  await api.storage.local.set({ [LIST_KEY]: next });
}

/** 切到某一条。 */
export async function setActiveProvider(id: string): Promise<void> {
  await api.storage.local.set({ [ACTIVE_KEY]: id });
}

/**
 * 删一条，连带删掉它的 key。
 *
 * 删掉之后 `activeId` 指向不存在的条目，`pickActiveId` 会退回第一条 —— 所以
 * 这里不用额外修 activeId。
 */
export async function removeProvider(id: string): Promise<void> {
  const [list, keys] = await Promise.all([readProviders(), readAllKeys()]);
  if (!list.some((e) => e.id === id)) return;
  delete keys[id];
  const next = list.filter((e) => e.id !== id);
  await api.storage.local.set({ [LIST_KEY]: next, [KEYS_KEY]: keys });
}

/** 写总开关。 */
export async function setEnabled(on: boolean): Promise<void> {
  const got = await api.storage.local.get(MIGRATED_KEY);
  const cur = (got[MIGRATED_KEY] ?? {}) as Record<string, unknown>;
  await api.storage.local.set({ [MIGRATED_KEY]: { ...cur, enabled: on } });
}

/** 清空全部：列表、key、开关。老的迁移来源键也一并清（用户明确要「清干净」）。 */
export async function clearAi(): Promise<void> {
  await api.storage.local.remove([LIST_KEY, KEYS_KEY, ACTIVE_KEY, MIGRATED_KEY]);
  await api.storage.local.remove([CONFIG_KEY, SECRET_KEY]);
}

// ---------------------------------------------------------------- 老结构迁移

/**
 * 把老结构（`ai.config` + `ai.apiKey`）迁进列表，**只做一次**。
 *
 * ## 为什么保留老键不删
 *
 * 万一新代码有 bug 需要回滚，用户的老配置还在。已经填进去的 key 是花了
 * 心思和时间设的，丢一次就是「这产品不靠谱」。
 *
 * ## 为什么标记键里顺带存 enabled
 *
 * 老结构的 `enabled` 就在 `ai.config` 里，迁移时一起带走。存到 MIGRATED_KEY
 * 下是为了保持「总开关独立于列表」的新结构。
 */
export async function migrateLegacy(): Promise<void> {
  try {
    const got = (await api.storage.local.get([
      MIGRATED_KEY,
      CONFIG_KEY,
      SECRET_KEY,
      LIST_KEY,
    ])) as Record<string, Record<string, unknown> | undefined>;
    if (got[MIGRATED_KEY]?.done === true) return; // 已迁过

    const list = normalizeList(got[LIST_KEY]);
    if (list.length > 0) {
      // 已有列表（用户已经用新 UI 建过条目）→ 只补 done 标记，不动列表
      await api.storage.local.set({
        [MIGRATED_KEY]: { done: true, enabled: got[MIGRATED_KEY]?.enabled === true },
      });
      return;
    }

    const old = got[CONFIG_KEY] as Partial<StoredAiConfig> | undefined;
    if (!old) {
      // 全新用户：只打标记，避免每次启动都重跑这段判断
      await api.storage.local.set({ [MIGRATED_KEY]: { done: true, enabled: false } });
      return;
    }

    const provider = isProvider(old.provider) ? old.provider : 'deepseek';
    const d = PROVIDER_DEFAULTS[provider];
    const entry: ProviderEntry = {
      id: newId(),
      provider,
      label: d.label,
      baseUrl: str(old.baseUrl, d.baseUrl),
      model: str(old.model, d.model),
    };
    const key = typeof got[SECRET_KEY] === 'string' ? String(got[SECRET_KEY]).trim() : '';

    const sets: Record<string, unknown> = {
      [LIST_KEY]: [entry],
      [ACTIVE_KEY]: entry.id,
      [MIGRATED_KEY]: { done: true, enabled: old.enabled === true },
    };
    // 迁移来源没有 key 时不要建空映射，否则 readAllKeys 每次都要白读一次
    if (key) sets[KEYS_KEY] = { [entry.id]: key };
    await api.storage.local.set(sets);
  } catch {
    // 迁移失败不阻塞：上层会看到空列表，用户手动加一条即可
  }
}

// ------------------------------------------------------ 本地开发便利：预填 key

/**
 * 构建期注入的开发用 API Key（见 vite.config.js → readDevCreds）。
 * 正式发版拿不到 → 编译成空串，本函数直接返回。
 */
declare const __DEV_CREDS__: { email: string; password: string; passphrase: string; aiKey: string };
const devAiKey =
  typeof __DEV_CREDS__ !== 'undefined' && typeof __DEV_CREDS__.aiKey === 'string'
    ? __DEV_CREDS__.aiKey.trim()
    : '';

/**
 * 首次运行时把注入的 key 预填进去，之后设置页就自带一条 DeepSeek 配置。
 *
 * ## 三条自律（这是「填了省事」与「泄密」的边界）
 *
 * 1. **只在没有任何 provider 条目时建**。用户已建的条目、已填的 key、已改的
 *    baseUrl/model 一律不动 —— 否则每次打开扩展都会重置他手动改的端点。
 * 2. **`enabled` 仍然留 false**。装了扩展不等于授权把书签发出去，开关必须由用户点。
 * 3. **只在本地构建有值**。CI 拿不到 `.dev-creds.json` → 空串 → 直接 return，
 *    商店用户拿到的是正常的「未配置」空态。
 *
 * 幂等：每次启动都调，只有第一次会真的写。
 */
export async function seedDevAiKey(): Promise<void> {
  if (!devAiKey) return;
  try {
    const [list, got] = await Promise.all([readProviders(), api.storage.local.get(KEYS_KEY)]);
    if (list.length > 0) return; // 已有条目 → 绝不碰
    if (Object.keys(normalizeKeys(got[KEYS_KEY])).length > 0) return;
    const entry: ProviderEntry = {
      id: newId(),
      provider: 'deepseek',
      label: PROVIDER_DEFAULTS.deepseek.label,
      baseUrl: PROVIDER_DEFAULTS.deepseek.baseUrl,
      model: PROVIDER_DEFAULTS.deepseek.model,
    };
    await api.storage.local.set({
      [LIST_KEY]: [entry],
      [ACTIVE_KEY]: entry.id,
      [KEYS_KEY]: { [entry.id]: devAiKey },
      [MIGRATED_KEY]: { done: true, enabled: false },
    });
  } catch {
    // 预填失败无所谓：设置页仍可手填，不该因此报错
  }
}
