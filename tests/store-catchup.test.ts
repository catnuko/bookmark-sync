/**
 * tests/store-catchup.test.ts — 商店补发判定的单元测试。
 *
 * 背景：Chrome Web Store 不允许「审核中再次提交」，且与版本号无关。发版时若 Chrome
 * 正在审上一版，版本闸门会跳过本次提交 —— 此后没有任何东西会把最新版推上去，
 * Chrome 就永久停在旧版本。store-catchup.mjs 由 store-versions.yml 定时调用，
 * 专门补这一刀。
 *
 * 这里只测纯判定逻辑（planCatchup），不碰网络与 gh CLI。
 */

import { describe, it, expect } from 'vitest';
import { planCatchup } from '../scripts/store-catchup.mjs';

describe('planCatchup（是否 dispatch 一次商店提交）', () => {
  it('Chrome 落后于最新 Release → 补发', () => {
    const r = planCatchup('2.16.2', { chrome: { version: '2.16.0' } });
    expect(r.dispatch).toBe(true);
    expect(r.reason).toContain('2.16.0 < 目标 2.16.2');
  });

  it('Chrome 已是最新 → 不补（避免重复提交被拒）', () => {
    const r = planCatchup('2.16.2', { chrome: { version: '2.16.2' } });
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain('无需补发');
  });

  it('Chrome 在审核中 → 不补（等审完再补，否则提交会被拒）', () => {
    const r = planCatchup('2.16.2', {
      chrome: { version: '2.10.1', pending: '2.16.2', pendingState: 'PENDING_REVIEW' },
    });
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain('正在审核中');
  });

  it('Chrome 高于最新（异常/回退）→ 不补', () => {
    const r = planCatchup('2.16.0', { chrome: { version: '2.16.2' } });
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain('无需补发');
  });

  it('Chrome 采集失败 → 不补（等下一轮，不做不可逆操作）', () => {
    const r = planCatchup('2.16.2', { chrome: { error: 'HTTP 403' } });
    expect(r.dispatch).toBe(false);
    expect(r.reason).toContain('采集失败');
  });

  it('Chrome 无数据 → 不补', () => {
    expect(planCatchup('2.16.2', { chrome: null }).dispatch).toBe(false);
    expect(planCatchup('2.16.2', {}).dispatch).toBe(false);
  });

  it('★ Edge / Firefox 落后不影响判定（只补 Chrome）', () => {
    // Edge 长期停在 2.10.1 是常态（店面端点看不到审核中版本，无法判断能否提交），
    // 不能因为它落后就 dispatch —— 否则每轮定时都会刷一个被拒的 run。
    const r = planCatchup('2.16.2', {
      chrome: { version: '2.16.2' },
      edge: { version: '2.10.1' },
      firefox: { version: '2.10.1' },
    });
    expect(r.dispatch).toBe(false);
  });
});
