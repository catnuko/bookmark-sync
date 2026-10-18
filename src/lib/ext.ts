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

/**
 * chrome.permissions 子集（可选 host 权限 / history 权限的申请与查询）。
 * 与 ai/hostAccess.ts 里那份局部声明形状一致，这里放一份供新模块共用。
 */
export interface ExtensionPermissions {
  contains(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  request(p: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  remove(p: { origins?: string[]; permissions?: string[] }): Promise<void>;
}

/** chrome.history 子集（健康洞察的「沉睡书签」统计用）。 */
export interface ExtensionHistory {
  /** 某 URL 的访问记录。空数组 = 从未访问过。 */
  getVisits(details: { url: string }): Promise<Array<{ visitTime?: number }>>;
  /**
   * 检索浏览历史。`text: ''` = 匹配全部。**不要依赖 `maxResults: 0` = 不限**的
   * 语义（Chrome 视 0 为不限，Firefox 文档含糊）——健康洞察实际传一个大数上限
   * （见 ai/health.ts 的 RECENT_VISIT_LIMIT），就是为了避开这个跨浏览器差异。
   *
   * ★ 健康洞察**必须用 search 而不是逐条 getVisits**：上千条书签各调一次
   * getVisits 是上千次异步往返，慢到不可接受；search 一次拿回整张历史表，
   * 在本地建 URL→lastVisitTime 映射，再 O(1) 比对每条书签。
   */
  search(query: {
    text: string;
    startTime?: number;
    endTime?: number;
    maxResults?: number;
  }): Promise<Array<{ url?: string; lastVisitTime?: number }>>;
}

/** omnibox 建议项（description 支持 XML 标记，见 src/omnibox.ts）。 */
export interface OmniboxSuggestion {
  content: string;
  description: string;
}

/**
 * chrome.omnibox 子集（地址栏搜索）。
 *
 * ★ 刻意**不含** `onInputEnded` —— Chrome 的 omnibox API 没有这个事件
 * （只有 onInputStarted / Changed / Entered / Cancelled / DeleteSuggestion）。
 */
export interface ExtensionOmnibox {
  setDefaultSuggestion(s: { description: string }): void;
  onInputStarted: { addListener(cb: () => void): void };
  onInputChanged: {
    addListener(cb: (text: string, suggest: (s: OmniboxSuggestion[]) => void) => void): void;
  };
  onInputEntered: { addListener(cb: (text: string, disposition: string) => void): void };
  onInputCancelled: { addListener(cb: () => void): void };
}

/** 全库使用的扩展 API 面（browser.* / chrome.* 公共子集）。 */
export interface ExtensionApi {
  storage: { local: StorageArea };
  runtime: ExtensionRuntime;
  bookmarks: ChromeBookmarksAPI;
  alarms?: ExtensionAlarms;
  tabs?: ExtensionTabs;
  permissions?: ExtensionPermissions;
  history?: ExtensionHistory;
  omnibox?: ExtensionOmnibox;
}

const g = globalThis as typeof globalThis & { browser?: unknown; chrome?: unknown };

export const api = (g.browser ?? g.chrome) as ExtensionApi;
