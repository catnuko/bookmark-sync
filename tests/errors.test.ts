/**
 * tests/errors.test.ts — `describeError` 的核心契约：**绝不丢信息**。
 *
 * 背景：同步失败时 `reason: 'error'` 分支若用 `String(e)` / `e?.message ?? String(e)`，
 * 非 Error 抛出物（supabase PostgrestError、普通对象）一律退化成 `"[object Object]"`，
 * 等于对着空报错查案。此处把「不许退化」钉死成断言。
 */

import { describe, it, expect } from 'vitest';
import { describeError } from '../src/lib/errors.js';

describe('describeError', () => {
  it('Error 实例 → message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('PostgrestError 形状的普通对象 → 带上 message/details/hint/code', () => {
    const pg = { message: 'duplicate key', details: 'Key (id)=(1)', hint: '', code: '23505' };
    const out = describeError(pg);
    expect(out).toContain('duplicate key');
    expect(out).toContain('23505');
    expect(out).toContain('Key (id)=(1)');
  });

  it('循环引用对象 → 不退化成 "[object Object]"，仍报出字段', () => {
    const a: Record<string, unknown> = { message: 'circular', code: 'X1' };
    a.self = a; // JSON.stringify 会抛
    const out = describeError(a);
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('circular');
    expect(out).toContain('X1');
  });

  it('无 own 属性的对象 → 至少带构造器名（不给一个空洞的 "{}"）', () => {
    class Weird {}
    const out = describeError(new Weird());
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('Weird');
  });

  it('取字段时抛错 → 标出来，不炸', () => {
    const poison = { code: 'E1' };
    Object.defineProperty(poison, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter 炸了');
      },
    });
    const out = describeError(poison);
    expect(out).toContain('E1');
    expect(out).toContain('boom');
  });

  it('原始值 → String(e)', () => {
    expect(describeError('plain string')).toBe('plain string');
    expect(describeError(null)).toBe('null');
    expect(describeError(42)).toBe('42');
  });
});
