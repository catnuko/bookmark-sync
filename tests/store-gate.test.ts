/**
 * tests/store-gate.test.ts — 商店提交版本闸门的单元测试。
 *
 * 背景：商店提交是发布流程里唯一会真过量上线给用户的动作，且同一版本重复提交
 * 会被三家以「版本号未递增」拒绝。release.yml 末尾自动 dispatch publish-stores.yml
 * 之前，必须由本闸门决定「要不要提交」。
 *
 * 这里只测纯判定逻辑（compareVersions / decideStore），不碰网络 —— 采集由
 * fetch-store-versions.mjs 负责，已有 dry-run 人工验证。
 */

import { describe, it, expect } from 'vitest';
import { compareVersions, decideStore } from '../scripts/store-gate.mjs';

describe('compareVersions（数值逐段比较，不是字符串序）', () => {
  it('同版本相等', () => {
    expect(compareVersions('2.15.2', '2.15.2')).toBe(0);
  });

  it('主版本不同', () => {
    expect(compareVersions('3.0.0', '2.15.2')).toBe(1);
    expect(compareVersions('2.15.2', '3.0.0')).toBe(-1);
  });

  it('★ 次版本 10 大于 9（字符串序会误判 9 > 10）', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
  });

  it('段数不同按 0 补齐', () => {
    expect(compareVersions('2.15', '2.15.0')).toBe(0);
    expect(compareVersions('2.15.1', '2.15')).toBe(1);
    expect(compareVersions('2.16', '2.15.9')).toBe(1);
  });
});

describe('decideStore（单家闸门判定）', () => {
  it('目标高于在架 → 提交', () => {
    expect(decideStore('2.15.2', { version: '2.10.1' })).toEqual({
      action: 'submit',
      reason: '在架 2.10.1 < 目标 2.15.2',
    });
  });

  it('目标等于在架 → 跳过', () => {
    const r = decideStore('2.15.2', { version: '2.15.2' });
    expect(r.action).toBe('skip');
    expect(r.reason).toContain('已等于目标');
  });

  it('目标低于在架 → 跳过（防版本回退重复提交）', () => {
    const r = decideStore('2.14.0', { version: '2.15.1' });
    expect(r.action).toBe('skip');
    expect(r.reason).toContain('已高于目标');
  });

  it('★ 目标正是 pending → 跳过（正在审，重复提交会被拒）', () => {
    const r = decideStore('2.15.2', {
      version: '2.15.1',
      pending: '2.15.2',
      pendingState: 'PENDING_REVIEW',
    });
    expect(r.action).toBe('skip');
    expect(r.reason).toContain('正在审核中');
    expect(r.reason).toContain('PENDING_REVIEW');
  });

  it('★ pending 是别的版本 → 也跳过（Chrome in-review 与目标无关，2026-10-15 v2.16.1/2.16.2 实测）', () => {
    // 在架 2.10.1、审核中 2.16.0，目标 2.16.2 —— 目标比 pending 高，但 Chrome 照样
    // 返回 400 NOT_UPDATEABLE，所以必须跳过。
    const r = decideStore('2.16.2', {
      version: '2.10.1',
      pending: '2.16.0',
      pendingState: 'PENDING_REVIEW',
    });
    expect(r.action).toBe('skip');
    expect(r.reason).toContain('2.16.0 正在审核中');
    expect(r.reason).toContain('与目标 2.16.2 不同但同样被拒');
  });

  it('pending 是非版本号（采集异常）→ 按无 pending 处理，照在架判定', () => {
    const r = decideStore('2.15.2', { version: '2.10.1', pending: null });
    expect(r.action).toBe('submit');
    expect(r.reason).toContain('在架 2.10.1 < 目标 2.15.2');
  });

  it('采集失败 → 放行（宁可红在商店侧，也不静默漏发）', () => {
    const r = decideStore('2.15.2', { error: 'HTTP 403' });
    expect(r.action).toBe('submit');
    expect(r.reason).toContain('采集失败');
  });

  it('无数据 → 放行', () => {
    expect(decideStore('2.15.2', null).action).toBe('submit');
    expect(decideStore('2.15.2', undefined).action).toBe('submit');
  });

  it('在架版本号异常 → 放行交商店判定', () => {
    const r = decideStore('2.15.2', { version: null });
    expect(r.action).toBe('submit');
    expect(r.reason).toContain('异常');
  });
});
