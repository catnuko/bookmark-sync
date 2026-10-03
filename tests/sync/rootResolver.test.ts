/**
 * tests/sync/rootResolver.test.ts — 按 folderType + syncing 解析根（Chrome 双子树）。
 *
 * 背景：<https://developer.chrome.com/blog/bookmarks-sync-changes>
 * 官方明说 id 不固定、不能用 id/name 认根，必须按 folderType 认类型、
 * syncing 认子树。本文件覆盖：归类、动态 id、缺失回退、受管书签忽略、
 * 树形状随身份状态变化、取不到树时的兜底。
 */

import { describe, it, expect } from 'vitest';
import { resolveRoots, type ChromeTreeNode } from '../../src/sync/index.js';
import {
  ROOT_UUID,
  BOOKMARKS_BAR_UUID,
  OTHER_BOOKMARKS_UUID,
  MOBILE_UUID,
  MENU_UUID,
  ACCOUNT_BOOKMARKS_BAR_UUID,
  ACCOUNT_OTHER_BOOKMARKS_UUID,
  ACCOUNT_MOBILE_UUID,
} from '../../src/crdt/index.js';

/** 造一棵「根 + 若干直接子节点」的树（子节点 id 故意不是 "1"/"2"/"3"）。 */
function treeWith(children: Array<Partial<ChromeTreeNode> & { id: string }>): ChromeTreeNode[] {
  return [
    {
      id: '0',
      title: '',
      children: children.map((c) => ({ title: '', ...c }) as ChromeTreeNode),
    },
  ];
}

const asMap = (pairs: Array<[string, string]>): Record<string, string> => Object.fromEntries(pairs);

describe('resolveRoots（Chrome 双子树）', () => {
  it('按 folderType + syncing 把四个根分到各自的固定 uuid（id 是动态的）', () => {
    const res = resolveRoots(
      treeWith([
        { id: 'A', folderType: 'bookmarks-bar', syncing: true },
        { id: 'B', folderType: 'other', syncing: true },
        { id: 'C', folderType: 'bookmarks-bar', syncing: false },
        { id: 'D', folderType: 'other', syncing: false },
      ]),
      false,
    );

    expect(res.rootChromeId).toBe('0');
    expect(asMap(res.pairs)).toEqual({
      '0': ROOT_UUID,
      A: ACCOUNT_BOOKMARKS_BAR_UUID,
      B: ACCOUNT_OTHER_BOOKMARKS_UUID,
      C: BOOKMARKS_BAR_UUID,
      D: OTHER_BOOKMARKS_UUID,
    });
    expect(res.rootIds).toEqual(new Set(['0', 'A', 'B', 'C', 'D']));
  });

  it('mobile 类型也认；syncing 缺省（undefined）按本地处理', () => {
    const res = resolveRoots(
      treeWith([
        { id: 'm1', folderType: 'mobile', syncing: false },
        { id: 'm2', folderType: 'mobile', syncing: true },
        // Chrome < 134 没有 syncing 字段 → 视作本地
        { id: 'x', folderType: 'other' },
      ]),
      false,
    );
    expect(asMap(res.pairs)).toEqual({
      '0': ROOT_UUID,
      m1: MOBILE_UUID,
      m2: ACCOUNT_MOBILE_UUID,
      x: OTHER_BOOKMARKS_UUID,
    });
  });

  it('受管书签（folderType="managed"）与未知类型一律忽略，不退回静态 id 表', () => {
    const res = resolveRoots(
      treeWith([
        { id: '1', folderType: 'managed' },
        { id: '2', folderType: 'something-new' },
        { id: '3', folderType: 'other', syncing: false },
      ]),
      false,
    );
    expect(asMap(res.pairs)).toEqual({ '0': ROOT_UUID, '3': OTHER_BOOKMARKS_UUID });
    expect(res.rootIds.has('1')).toBe(false);
    expect(res.rootIds.has('2')).toBe(false);
  });

  it('没有 folderType（Chrome < 134）时退回静态 id 表', () => {
    const res = resolveRoots(
      treeWith([
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' }, // 账号根（无 folderType）→ 静态表认不出 → 忽略
      ]),
      false,
    );
    expect(asMap(res.pairs)).toEqual({
      '0': ROOT_UUID,
      '1': BOOKMARKS_BAR_UUID,
      '2': OTHER_BOOKMARKS_UUID,
      '3': MOBILE_UUID,
    });
  });

  it('Firefox：按 guid 认根，menu________ 映射 MENU_UUID', () => {
    const res = resolveRoots(
      [
        {
          id: 'root________',
          title: '',
          children: [
            { id: 'menu________', title: '书签菜单' },
            { id: 'toolbar_____', title: '书签工具栏' },
            { id: 'unfiled_____', title: '其他书签' },
            { id: 'mobile______', title: '移动书签' },
            { id: 'tags________', title: '标签' }, // 不在表里 → 忽略
          ],
        },
      ],
      true,
    );
    expect(res.rootChromeId).toBe('root________');
    expect(asMap(res.pairs)).toEqual({
      root________: ROOT_UUID,
      menu________: MENU_UUID,
      toolbar_____: BOOKMARKS_BAR_UUID,
      unfiled_____: OTHER_BOOKMARKS_UUID,
      mobile______: MOBILE_UUID,
    });
  });

  it('未登录（只有本地根）/ 已登录且本地为空（只有账号根）都能正确解析', () => {
    const signedOut = resolveRoots(
      treeWith([
        { id: '1', folderType: 'bookmarks-bar', syncing: false },
        { id: '2', folderType: 'other', syncing: false },
      ]),
      false,
    );
    expect(Object.values(asMap(signedOut.pairs))).toEqual([
      ROOT_UUID,
      BOOKMARKS_BAR_UUID,
      OTHER_BOOKMARKS_UUID,
    ]);

    const localEmpty = resolveRoots(
      treeWith([
        { id: 'A', folderType: 'bookmarks-bar', syncing: true },
        { id: 'B', folderType: 'other', syncing: true },
      ]),
      false,
    );
    expect(Object.values(asMap(localEmpty.pairs))).toEqual([
      ROOT_UUID,
      ACCOUNT_BOOKMARKS_BAR_UUID,
      ACCOUNT_OTHER_BOOKMARKS_UUID,
    ]);
  });

  it('取不到树时退回静态表（不把桥建成空的）', () => {
    const res = resolveRoots([], false);
    expect(res.rootChromeId).toBe('0');
    expect(asMap(res.pairs)).toEqual({
      '0': ROOT_UUID,
      '1': BOOKMARKS_BAR_UUID,
      '2': OTHER_BOOKMARKS_UUID,
      '3': MOBILE_UUID,
    });
  });

  it('同一 uuid 只认第一个（防御重复节点这类异常形状）', () => {
    const res = resolveRoots(
      treeWith([
        { id: '1', folderType: 'bookmarks-bar', syncing: false },
        { id: 'dup', folderType: 'bookmarks-bar', syncing: false },
      ]),
      false,
    );
    expect(asMap(res.pairs)).toEqual({ '0': ROOT_UUID, '1': BOOKMARKS_BAR_UUID });
  });

  /**
   * ★ 真机复现（2026-10-01，用户 Mac Chrome 的 Default profile）。
   *
   * 这台机器**恰好是「已登录 + 本地为空」形态**：根下只有两个子节点，**都是
   * `syncing:true`**，id 是动态的 `"5"/"6"`（不是 `"1"/"2"`），账号书签栏里有
   * 1288 条书签。旧代码 `fixedRootUuid("5")` 返回 null → `captureLocalTree`
   * 整棵 `return` → **1288 条一条都不同步**（同步显示成功）。
   *
   * 这条用例把真机形状钉成回归：id 是 `"5"/"6"` 也必须解析出账号根。
   */
  it('真机形状：根下只有账号根（id "5"/"6"、无本地根）→ 全部解析为账号根', () => {
    const res = resolveRoots(
      treeWith([
        { id: '5', folderType: 'bookmarks-bar', syncing: true },
        { id: '6', folderType: 'other', syncing: true },
      ]),
      false,
    );
    expect(res.rootChromeId).toBe('0');
    expect(asMap(res.pairs)).toEqual({
      '0': ROOT_UUID,
      '5': ACCOUNT_BOOKMARKS_BAR_UUID,
      '6': ACCOUNT_OTHER_BOOKMARKS_UUID,
    });
    expect(res.rootIds).toEqual(new Set(['0', '5', '6']));
  });
});
