/**
 * src/ai/config.ts — AI 配置的落盘与读取。
 *
 * ## 存哪
 *
 * 统一走 `chrome.storage.local`（经 lib/ext.ts 的 `api.storage`）。**不进
 * `chrome.storage.sync`** —— 那会跟着用户账号漫游到其它设备，等于把 API Key
 * 复制到每一台机器上。BYOK 的前提是「只有我这台机器知道这个 key」。
 *
 * 这与 sync/keyManager.ts 的口令我方一致：两者都只落 local，从不漫游。
 *
 * ## 存什么
 *
 * 配置（provider / baseUrl / model）明文存 —— 它们不是秘密，丢了重填即可，
 * 而且设置页要显示出来。
 *
 * Key 本身也存 local（用户填的，不存就等于每次都要重输），但**只存本机**。
 * 商店包里不含任何真实 key：key 是用户运行期填进去的，不进 git、不进构建产物。
 *
 * ## 读写的形状
 *
 * 存储是单 key（`ai.config`）存一个 JSON 对象，而不是散成多个 key：
 * 避免半写状态（改了 provider 没改 model 之类）。读时做一次归一化，
 * 坏数据不抛穿 —— 拿不到配置就当「未配置」，UI 走空态。
 */

import { api } from '../lib/ext.js';
import { PROVIDER_DEFAULTS, type AiConfig, type AiProvider } from './provider.js';

const CONFIG_KEY = 'ai.config';
const SECRET_KEY = 'ai.apiKey';

const PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'deepseek', 'custom'];

/** 从存储读出的完整配置：不含 key（key 要单独取，见 readApiKey）。 */
export interface StoredAiConfig extends AiConfig {
  /** 用户是否显式启用了 AI。总开关，默认关 —— 装了扩展不等于授权发数据。 */
  enabled: boolean;
}

function isProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/**
 * 归一化任意来源的配置。逐字段兜底，坏值退回默认 —— 设置页不该因为一条脏数据白屏。
 */
function normalize(raw: unknown): StoredAiConfig {
  const o = (raw ?? {}) as Partial<StoredAiConfig>;
  const provider = isProvider(o.provider) ? o.provider : 'anthropic';
  const d = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    baseUrl: typeof o.baseUrl === 'string' && o.baseUrl.trim() ? o.baseUrl.trim() : d.baseUrl,
    model: typeof o.model === 'string' && o.model.trim() ? o.model.trim() : d.model,
    enabled: o.enabled === true,
  };
}

/** 读配置。未配置时返回默认（enabled=false，即「没开」）。 */
export async function readAiConfig(): Promise<StoredAiConfig> {
  try {
    const got = await api.storage.local.get(CONFIG_KEY);
    return normalize(got[CONFIG_KEY]);
  } catch {
    return normalize(null);
  }
}

export async function writeAiConfig(cfg: StoredAiConfig): Promise<void> {
  await api.storage.local.set({ [CONFIG_KEY]: normalize(cfg) });
}

/** 读 API Key。不存在返回空串（调用方据此判定「未配置」）。 */
export async function readApiKey(): Promise<string> {
  try {
    const got = await api.storage.local.get(SECRET_KEY);
    const v = got[SECRET_KEY];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

export async function writeApiKey(key: string): Promise<void> {
  // 空串视作清除：设置页里清空输入框即删除，不留一个「看起来配好了其实是空」的残值。
  if (!key.trim()) {
    await api.storage.local.remove(SECRET_KEY);
    return;
  }
  await api.storage.local.set({ [SECRET_KEY]: key.trim() });
}

/**
 * 换服务商时把 baseUrl / model 一起带到该服务商的默认值。
 *
 * 只有当当前值还是**上一个服务商的默认值**（即用户没手动改过）才替换 —— 否则
 * 覆盖掉用户特意填的代理地址。判断方式是跟任一 provider 的默认值比对。
 */
export async function switchProvider(
  current: StoredAiConfig,
  next: AiProvider,
): Promise<StoredAiConfig> {
  const wasDefault = Object.values(PROVIDER_DEFAULTS).some(
    (d) => d.baseUrl === current.baseUrl || d.model === current.model,
  );
  const d = PROVIDER_DEFAULTS[next];
  return normalize({
    ...current,
    provider: next,
    baseUrl: wasDefault ? d.baseUrl : current.baseUrl,
    model: wasDefault ? d.model : current.model,
  });
}

/**
 * 清空 AI 相关的一切（配置 + key）。设置页的「清除」按钮用。
 * 分两次写而不是整体覆盖：SECRET_KEY 可能本来就不存在。
 */
export async function clearAi(): Promise<void> {
  await api.storage.local.remove(SECRET_KEY);
  await api.storage.local.set({ [CONFIG_KEY]: normalize({ enabled: false }) });
}
