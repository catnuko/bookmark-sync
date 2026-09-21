/**
 * tests/sync/binding.test.ts — 设备 ↔ 空间绑定决策（纯函数）。
 *
 * 锁死的不变式（破坏任意一条都会让用户失去选择权或丢书签）：
 *   1. **多个空间可选时必须问用户**（`ask_user`）——擅自替用户绑定默认空间会
 *      抹掉「本机从未绑定过」这个事实，用户再也没机会选这台电脑加入哪个空间；
 *   2. 只有一个空间 / 一个都没有时不弹窗（没得选，打扰没意义）；
 *   3. 已绑定就照常同步，不重复引导；
 *   4. 绑定模式非法值一律退回 `merge`（不破坏本机数据的那个），
 *      绝不能因为乱值而误走「清空本机」的 `overwrite`。
 */

import { describe, it, expect } from 'vitest';
import { firstBindAction, normalizeBindMode } from '../../src/sync/index.js';

describe('firstBindAction — 首绑决策', () => {
  it('已绑定：照常同步，不重复引导', () => {
    expect(firstBindAction(0, true)).toBe('already');
    expect(firstBindAction(1, true)).toBe('already');
    expect(firstBindAction(5, true)).toBe('already');
  });

  it('账号下一个空间都没有 → 自动建默认空间', () => {
    expect(firstBindAction(0, false)).toBe('create_default');
  });

  it('只有一个空间 → 静默绑定，不弹窗', () => {
    expect(firstBindAction(1, false)).toBe('auto_bind');
  });

  it('多个空间 → 必须问用户（擅自绑定会让用户永久失去选择权）', () => {
    expect(firstBindAction(2, false)).toBe('ask_user');
    expect(firstBindAction(3, false)).toBe('ask_user');
    expect(firstBindAction(99, false)).toBe('ask_user');
  });
});

describe('normalizeBindMode — 绑定模式归一化', () => {
  it('保留合法值', () => {
    expect(normalizeBindMode('merge')).toBe('merge');
    expect(normalizeBindMode('overwrite')).toBe('overwrite');
  });

  it('非法值一律退回 merge（绝不误走清空本机）', () => {
    for (const bad of [undefined, null, '', 'MERGE', 'Overwrite', 'clear', 0, 1, {}, []]) {
      expect(normalizeBindMode(bad)).toBe('merge');
    }
  });
});
