/**
 * tests/lib/historyAccess.test.ts — 浏览历史可选权限的申请与查询。
 *
 * 这一层是「沉睡书签」能否统计的唯一开关，且必须在**用户手势内**调用
 * `permissions.request`。这里锁住三件事：请求的权限名正确（`history`）、
 * 非扩展环境一律降级为 false、抛错不穿到 UI。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hasHistoryAccess,
  requestHistoryAccess,
  revokeHistoryAccess,
} from '../../src/lib/historyAccess.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubPerms(impl: {
  contains?: (p: unknown) => Promise<boolean>;
  request?: (p: unknown) => Promise<boolean>;
  remove?: (p: unknown) => Promise<void>;
}) {
  const contains = vi.fn(impl.contains ?? (async () => true));
  const request = vi.fn(impl.request ?? (async () => true));
  const remove = vi.fn(impl.remove ?? (async () => undefined));
  vi.stubGlobal('chrome', { permissions: { contains, request, remove } });
  return { contains, request, remove };
}

describe('hasHistoryAccess', () => {
  it('★ 查的是 permissions:["history"]（而不是 origins）', async () => {
    const { contains } = stubPerms({});
    expect(await hasHistoryAccess()).toBe(true);
    expect(contains).toHaveBeenCalledWith({ permissions: ['history'] });
  });

  it('未授权 → false', async () => {
    stubPerms({ contains: async () => false });
    expect(await hasHistoryAccess()).toBe(false);
  });

  it('★ 非扩展环境（无 chrome.permissions）→ false，不抛', async () => {
    expect(await hasHistoryAccess()).toBe(false);
  });

  it('contains 抛错 → false', async () => {
    stubPerms({
      contains: async () => {
        throw new Error('nope');
      },
    });
    expect(await hasHistoryAccess()).toBe(false);
  });
});

describe('requestHistoryAccess', () => {
  it('★ 请求 permissions:["history"]，返回用户是否同意', async () => {
    const { request } = stubPerms({});
    expect(await requestHistoryAccess()).toBe(true);
    expect(request).toHaveBeenCalledWith({ permissions: ['history'] });
  });

  it('用户拒绝 → false', async () => {
    stubPerms({ request: async () => false });
    expect(await requestHistoryAccess()).toBe(false);
  });

  it('★ 手势失效（request 抛错）→ 一律视为未获批，不抛穿', async () => {
    stubPerms({
      request: async () => {
        throw new Error('must be called during a user gesture');
      },
    });
    expect(await requestHistoryAccess()).toBe(false);
  });

  it('非扩展环境 → false', async () => {
    expect(await requestHistoryAccess()).toBe(false);
  });
});

describe('revokeHistoryAccess', () => {
  it('调用 remove({permissions:["history"]})', async () => {
    const { remove } = stubPerms({});
    await revokeHistoryAccess();
    expect(remove).toHaveBeenCalledWith({ permissions: ['history'] });
  });

  it('未持有该权限时 remove 抛错 → 静默吞掉', async () => {
    stubPerms({
      remove: async () => {
        throw new Error('not granted');
      },
    });
    await expect(revokeHistoryAccess()).resolves.toBeUndefined();
  });
});
