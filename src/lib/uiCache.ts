// 首屏缓存（stale-while-revalidate）—— 让 popup / 设置页「打开即出界面」。
//
// 背景：popup 每次打开都是全新页面，云端数据（付费档案 / 空间 / 设备）只能现场取。
// 把首屏渲染压在这些请求上就是「打开要转好几秒」——本机走代理时一次往返 ~0.9s，
// 三次串行就 2~3s。这里把上一帧的云端投影落盘，下次打开先渲染缓存、再后台刷新：
// 渲染不再阻塞在网络往返上，也不会闪出「FREE / 升级」这类错档位状态。
//
// 只存展示用的只读投影（不含密钥 / 口令 / 书签内容），且按账号存（`u`）——
// 换账号或未登录一律视为无缓存，登出时清掉。
import { api } from './ext.js';
import type { ProfileInfo, SpaceInfo, DeviceInfo } from '../sync.js';

const KEY = 'uiCache.v1';

/** 首屏渲染所需的云端投影（都是 state 里的原样值）。 */
export interface UiCache {
  profile: ProfileInfo | null;
  serverCount: number | null;
  spaces: SpaceInfo[];
  activeSpace: SpaceInfo | null;
  boundStale: boolean;
  devices: DeviceInfo[];
}

/**
 * 数组字段的边界校验。
 *
 * 读回来的 `spaces` / `devices` 必须是真数组——坏缓存（见 writeUiCache）里它们是
 * 数字键对象，直接塞进 state 会让下游的 `spaces.find(...)` 抛
 * `TypeError: ...find is not a function`。缓存只是优化，非数组一律当空。
 */
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** 读本账号的首屏缓存；账号不符（换账号 / 未登录）或无缓存返回 null。 */
export async function readUiCache(userId: string): Promise<UiCache | null> {
  if (!userId) return null;
  try {
    const { [KEY]: raw } = await api.storage.local.get(KEY);
    const rec = raw as { u?: string; data?: Partial<UiCache> } | undefined;
    if (!rec || rec.u !== userId || !rec.data) return null;
    const d = rec.data;
    return {
      profile: (d.profile as ProfileInfo | null) ?? null,
      serverCount: typeof d.serverCount === 'number' ? d.serverCount : null,
      spaces: asArray<SpaceInfo>(d.spaces),
      activeSpace: (d.activeSpace as SpaceInfo | null) ?? null,
      boundStale: d.boundStale === true,
      devices: asArray<DeviceInfo>(d.devices),
    };
  } catch {
    return null; // 缓存读失败只是退化成「没有缓存」
  }
}

/**
 * 写本账号的首屏缓存（整块覆盖，调用方传当前 state 的投影）。
 *
 * ★ 落盘前必须过一遍 `JSON.parse(JSON.stringify(...))`：调用方传的是 Vue 的
 * reactive 投影，数组字段（spaces / devices）是 Proxy。chrome.storage 的序列化
 * 走 `v8::Value::IsArray()`，对 Proxy 返回 **false** —— 数组会被写成
 * `{"0":{…}}` 这样的数字键对象，空数组写成 `{}`。读回来再 `spaces.find(...)`
 * 就是 `TypeError: find is not a function`（2026-09-29 实测复现）。
 * `JSON.stringify` 走的是规范的 `IsArray`（会拆 Proxy），是这里唯一能把响应式
 * 数组还原成真数组的一步。
 */
export async function writeUiCache(userId: string, data: UiCache): Promise<void> {
  if (!userId) return;
  try {
    const plain = JSON.parse(JSON.stringify(data)) as UiCache;
    await api.storage.local.set({ [KEY]: { u: userId, at: Date.now(), data: plain } });
  } catch {
    /* 缓存写失败不影响功能 */
  }
}

/** 登出 / 会话失效时清掉——避免换账号后把上个账号的空间名、设备名留在盘上。 */
export async function clearUiCache(): Promise<void> {
  try {
    await api.storage.local.remove(KEY);
  } catch {
    /* 忽略 */
  }
}
