/**
 * tests/firefox-android-manifest.test.ts — 禁止把插件装到 Firefox for Android。
 *
 * 背景（2026-10-20）：Firefox for Android **不支持** bookmarks API。MDN 的
 * browser-compat-data 里 `webextensions.api.bookmarks` 的 `firefox_android` 是
 * `{ "version_added": false }`，且全部 24 个子 API（create / getTree / search /
 * move / onCreated …）无一例外都是 false —— 不是「某个版本之后会支持」，是
 * **从来就不支持**，也看不到要支持的计划。
 *
 * 而 manifest 里只要写了 `gecko_android`，AMO 就会把插件列为安卓可安装。
 * 装上去之后 `chrome.bookmarks` 是 undefined，`registerLocalEventBridge()` 在
 * background.js **模块顶层**抛 TypeError，中断整个后台脚本 —— 后续的
 * scheduleAlarms / onStartup / onMessage 全部注册不上，插件彻底不工作。
 *
 * 线上实测（修复前）：Android Firefox 用户的 refresh token 一直在续期（说明插件
 * 还装着），但 bsync_devices 一条记录都没有（心跳从未发出）；错误报表里
 * `can't access property "onCreated", e is undefined` 跨 2.10.1 / 2.16.2 / 2.17.0
 * 三个版本持续复现。
 *
 * 所以这里钉死：**manifest.firefox.json 不得声明 gecko_android**。
 * 这条配置没有任何类型或运行时反馈，删了不会报错，只会在下次发版时静默地把
 * 插件重新放回安卓商店 —— 正是需要护栏的那类配置。
 *
 * ⚠ 如果将来 Mozilla 真的在安卓上实现了 bookmarks API（去 BCD 核实
 *   `firefox_android.version_added` 变成版本号），再连同本测试一起放开；
 *   不要只删测试。
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../public/manifest.firefox.json', import.meta.url), 'utf8'),
) as {
  browser_specific_settings?: { gecko?: unknown; gecko_android?: unknown };
  permissions?: string[];
};

describe('manifest.firefox.json 的安卓支持', () => {
  it('不得声明 gecko_android（安卓不支持 bookmarks API）', () => {
    expect(manifest.browser_specific_settings).not.toHaveProperty('gecko_android');
  });

  it('仍保留桌面 gecko 配置（id / 版本 / 数据收集声明）', () => {
    const gecko = manifest.browser_specific_settings?.gecko as
      | { id?: string; strict_min_version?: string; data_collection_permissions?: unknown }
      | undefined;
    expect(gecko?.id).toBe('bookmark-sync@bookmarksync.app');
    expect(gecko?.strict_min_version).toBeTruthy();
    // AMO 审核要求：数据收集权限声明不能丢
    expect(gecko?.data_collection_permissions).toBeTruthy();
  });

  it('仍声明 bookmarks 权限（桌面版的核心能力）', () => {
    expect(manifest.permissions).toContain('bookmarks');
  });
});
