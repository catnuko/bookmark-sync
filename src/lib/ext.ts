// 浏览器扩展 API 注入
// 优先 browser.*（Firefox / Safari / Chrome 148+ / Edge 136+ 均为 Promise 风格），
// 旧版 Chrome/Edge 无 browser 时回退到 chrome.*（MV3 同样返回 Promise）。
//
// 项目未安装 @types/chrome：这里用「最小结构类型」描述全库实际用到的 API 面，
// 统一从 globalThis 归一化出来。browser.* 与 chrome.* 的方法签名一致，故
// 同一接口即可覆盖两端。新增 API 使用时需同步扩展本接口（保持无 any）。

import type { ChromeBookmarksAPI } from '../sync/index.js';

/** chrome.storage.StorageArea 的 Promise 风格子集（MV3 / Firefox browser.*）。 */
export interface StorageArea {
  get(key?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** runtime 消息的公共形状：{ type } 判别 + 按消息类型扩展的字段。 */
export interface ExtensionMessage {
  type?: string;
  [key: string]: unknown;
}

/** chrome.runtime 的 Promise + 回调双风格子集。 */
export interface ExtensionRuntime {
  sendMessage(message: unknown, responseCallback?: (response: unknown) => void): Promise<unknown>;
  onMessage: {
    addListener(
      listener: (
        message: ExtensionMessage,
        sender: unknown,
        sendResponse: (response?: unknown) => void,
      ) => boolean | void,
    ): void;
  };
  onMessageExternal?: {
    addListener(
      listener: (
        message: ExtensionMessage,
        sender: { id?: string },
        sendResponse: (response?: unknown) => void,
      ) => boolean | void,
    ): void;
  };
  onInstalled: {
    addListener(listener: (details: unknown) => void): void;
  };
  onStartup: {
    addListener(listener: () => void): void;
  };
  /** 扩展自身的 manifest（取版本号用于错误上报；非扩展环境为 undefined）。 */
  getManifest?(): { version?: string } | undefined;
}

/** chrome.alarms 子集（MV3 service worker 唯一可靠定时器）。 */
export interface ExtensionAlarms {
  create(
    name: string,
    alarmInfo: { periodInMinutes?: number; when?: number; delayInMinutes?: number },
  ): void;
  onAlarm?: {
    addListener(listener: (alarm: { name: string }) => void): void;
  };
}

/** chrome.tabs 子集（仅弹新标签页）。 */
export interface ExtensionTabs {
  create(createProperties: { url: string }): Promise<unknown>;
}

/** 全库使用的扩展 API 面（browser.* / chrome.* 公共子集）。 */
export interface ExtensionApi {
  storage: { local: StorageArea };
  runtime: ExtensionRuntime;
  bookmarks: ChromeBookmarksAPI;
  alarms?: ExtensionAlarms;
  tabs?: ExtensionTabs;
}

const g = globalThis as typeof globalThis & { browser?: unknown; chrome?: unknown };

export const api = (g.browser ?? g.chrome) as ExtensionApi;
