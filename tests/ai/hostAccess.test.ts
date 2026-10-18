/**
 * tests/ai/hostAccess.test.ts — 运行时 host 权限（optional_host_permissions）的申请与查询。
 *
 * 这一层的错误不会抛异常、不会红字，只会让功能**静默失效**，所以测试重心压在
 * 「降级路径」而不是 happy path：
 *   - `permissions.contains({origins})` 传的是**匹配模式**而不是裸 origin。传错
 *     的表现是「明明授权了却查不到」→ 每次进设置页都重新弹授权框，用户以为坏了。
 *   - `request()` 只在用户手势内有效。调用方写成 `await something(); await request()`
 *     就被拒，返回 false —— 于是自建端点 / 链接体检静默变成「不工作」。
 *   - 广域权限要求 https + http **两个** pattern 全授予。少判一个，链接体检就把
 *     broken 站点报成 unknown，用户照着「修复」一个其实没坏的链接。
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  OPTIONAL_HOST_PATTERNS,
  hasBroadHostAccess,
  hasHostAccess,
  originOf,
  requestBroadHostAccess,
  requestHostAccess,
  revokeHostAccess,
} from '../../src/ai/hostAccess.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 造一份 fake `chrome.permissions`，返回三个 spy 供断言调用参数。 */
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

/**
 * 从 manifest 读 optional_host_permissions（两个 manifest 都必须有这份数组，
 * 否则 Firefox 构建出来的扩展 `request()` 会被直接拒掉）。
 */
function manifestPatterns(file: 'public/manifest.json' | 'public/manifest.firefox.json'): string[] {
  const m = JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')) as {
    optional_host_permissions?: string[];
  };
  return [...(m.optional_host_permissions ?? [])].sort();
}

describe('OPTIONAL_HOST_PATTERNS', () => {
  it('★ 与 manifest 的 optional_host_permissions 逐字一致（漏一个 request 就被拒）', () => {
    // 文件头约束 2：manifest 里没声明的域，request() 会直接被拒 —— 而那种失败
    // 没有任何报错，只是授权框永远不弹。所以常量与 manifest 必须同源。
    expect([...OPTIONAL_HOST_PATTERNS].sort()).toEqual(manifestPatterns('public/manifest.json'));
    expect([...OPTIONAL_HOST_PATTERNS].sort()).toEqual(
      manifestPatterns('public/manifest.firefox.json'),
    );
  });

  it('★ 是 https + http 两条通配，不是 <all_urls>', () => {
    // <all_urls> 会把 file:// / ftp:// 也收进来：权限面变大、审核要多解释一句，
    // 而自建 AI 端点与链接体检都不需要那两个协议。
    expect(OPTIONAL_HOST_PATTERNS).toEqual(['https://*/*', 'http://*/*']);
    expect(OPTIONAL_HOST_PATTERNS).not.toContain('<all_urls>');
  });
});

describe('originOf', () => {
  it('取 origin，丢掉 path / query / fragment', () => {
    expect(originOf('https://a.com/p?q=1#f')).toBe('https://a.com');
    // 自建网关常带端口（Ollama 11434），端口是 origin 的一部分，不能丢
    expect(originOf('http://localhost:11434/v1/chat')).toBe('http://localhost:11434');
    expect(originOf('https://a.com:8443/x')).toBe('https://a.com:8443');
  });

  it('★ 协议非 http(s) → null（chrome:// / data: / file:// 拿不到 host 权限）', () => {
    // 这三类连 origin 都不存在（`new URL('chrome://extensions').origin` 是
    // 'null://' 这种怪东西），绝不能拿它去拼 `origin + '/*'` 的匹配模式。
    for (const bad of [
      'chrome://extensions',
      'file:///etc/hosts',
      'data:text/plain,hi',
      'javascript:alert(1)',
    ]) {
      expect(originOf(bad)).toBeNull();
    }
  });

  it('★ 非法 URL → null，不做猜测（交给调用方报错）', () => {
    // 若这里返回空串或原值，调用方（PaneAI）会拿一个假 origin 去查权限，
    // 于是「已授权」的判断永远错。空串与纯空白同样算非法。
    expect(originOf('not a url')).toBeNull();
    expect(originOf('')).toBeNull();
    expect(originOf('   ')).toBeNull();
    expect(originOf('//a.com/p')).toBeNull();
  });

  it('前后空白被 trim（手输的 baseUrl 常带）', () => {
    expect(originOf('  https://a.com/p  ')).toBe('https://a.com');
  });
});

describe('hasHostAccess', () => {
  it('★ contains 传匹配模式 `<origin>/*`，不是裸 origin', async () => {
    const { contains } = stubPerms({});
    expect(await hasHostAccess('https://a.com')).toBe(true);
    // 裸 origin `https://a.com` 匹配不到任何实际 URL —— 少了 `/*` 的表现为
    // 「授权了却查不到」，每次打开设置页都重新弹框。
    expect(contains).toHaveBeenCalledWith({ origins: ['https://a.com/*'] });
  });

  it('带端口的 origin 也要拼 /*', async () => {
    const { contains } = stubPerms({});
    expect(await hasHostAccess('http://localhost:11434')).toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: ['http://localhost:11434/*'] });
  });

  it('未授权 → false', async () => {
    stubPerms({ contains: async () => false });
    expect(await hasHostAccess('https://a.com')).toBe(false);
  });

  it('★ 非扩展环境（无 chrome.permissions）→ false，不抛', async () => {
    // 单测 / 非扩展上下文里 api 是 undefined。抛穿会让调用方以为「查权限」
    // 这一步出了严重错误，而真实语义只是「这里没有权限可查」。
    expect(await hasHostAccess('https://a.com')).toBe(false);
  });

  it('contains 抛错 → false', async () => {
    stubPerms({
      contains: async () => {
        throw new Error('nope');
      },
    });
    expect(await hasHostAccess('https://a.com')).toBe(false);
  });
});

describe('requestHostAccess', () => {
  it('★ request 传匹配模式 `<origin>/*`，返回用户是否同意', async () => {
    const { request } = stubPerms({});
    expect(await requestHostAccess('https://a.com')).toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ['https://a.com/*'] });
  });

  it('用户拒绝 → false', async () => {
    stubPerms({ request: async () => false });
    expect(await requestHostAccess('https://a.com')).toBe(false);
  });

  it('★ 手势失效（request 抛错）→ 一律视为未获批，不抛穿', async () => {
    // 文件头约束 1：写成 `await something(); await request()` 时第一个 await
    // 就把手势吃掉了，request() 抛 "must be called during a user gesture"。
    // 抛穿会让整个 click handler 挂掉；吞成 false 则调用方走降级路径。
    stubPerms({
      request: async () => {
        throw new Error('must be called during a user gesture');
      },
    });
    expect(await requestHostAccess('https://a.com')).toBe(false);
  });

  it('非扩展环境 → false，不抛', async () => {
    expect(await requestHostAccess('https://a.com')).toBe(false);
  });
});

describe('revokeHostAccess', () => {
  it('★ remove 传匹配模式 `<origin>/*`（与 query 对称）', async () => {
    const { remove } = stubPerms({});
    await revokeHostAccess('https://a.com');
    expect(remove).toHaveBeenCalledWith({ origins: ['https://a.com/*'] });
  });

  it('remove 抛错（未持有该权限）→ resolve，不抛穿', async () => {
    stubPerms({
      remove: async () => {
        throw new Error('not granted');
      },
    });
    await expect(revokeHostAccess('https://a.com')).resolves.toBeUndefined();
  });

  it('非扩展环境 → resolve，不抛', async () => {
    await expect(revokeHostAccess('https://a.com')).resolves.toBeUndefined();
  });
});

describe('hasBroadHostAccess', () => {
  it('★ 两个 pattern 全授予才 true（linkCheck 判 broken/unknown 的分水岭）', async () => {
    // linkCheck 依赖广域权限才能读到跨域 fetch 的 404：少一个 pattern，
    // 对那个协议的站点就拿到 opaque 响应、读不到状态码，broken 被报成
    // unknown —— 用户会照着「修复」一个其实没坏的链接。
    const { contains } = stubPerms({
      contains: async (p) => {
        const origins = (p as { origins: string[] }).origins;
        // 只有问到的每个 pattern 都在已授予集合里才算有 —— 与实现同口径的
        // 「全授予」，所以这条守住的是「问的是整批」而不是「答得对」。
        return origins.every((o) => (OPTIONAL_HOST_PATTERNS as readonly string[]).includes(o));
      },
    });
    expect(await hasBroadHostAccess()).toBe(true);
    // 整批一起问，而不是逐个协议问：manifest 的 request() 是一次性整批授予的
    expect(contains).toHaveBeenCalledWith({
      origins: ['https://*/*', 'http://*/*'],
    });
  });

  it('★ 只授予 https 通配 → false（不是「部分授予也算有」）', async () => {
    stubPerms({
      contains: async (p) => {
        const origins = (p as { origins: string[] }).origins;
        return origins.every((o) => o === 'https://*/*');
      },
    });
    expect(await hasBroadHostAccess()).toBe(false);
  });

  it('只授予 http 通配 → false', async () => {
    stubPerms({
      contains: async (p) => {
        const origins = (p as { origins: string[] }).origins;
        return origins.every((o) => o === 'http://*/*');
      },
    });
    expect(await hasBroadHostAccess()).toBe(false);
  });

  it('★ 与单 origin 查询的差异：只授了某个具体站点不算广域', async () => {
    // 这是本函数与 hasHostAccess 的关键区别 —— hasHostAccess('https://a.com')
    // 在这里会返回 true，但广域权限仍然没有（不能对任意站点发请求）。
    stubPerms({
      contains: async (p) => {
        const origins = (p as { origins: string[] }).origins;
        return origins.every((o) => o === 'https://a.com/*');
      },
    });
    expect(await hasHostAccess('https://a.com')).toBe(true);
    expect(await hasBroadHostAccess()).toBe(false);
  });

  it('非扩展环境 → false，不抛', async () => {
    expect(await hasBroadHostAccess()).toBe(false);
  });

  it('contains 抛错 → false', async () => {
    stubPerms({
      contains: async () => {
        throw new Error('nope');
      },
    });
    expect(await hasBroadHostAccess()).toBe(false);
  });
});

describe('requestBroadHostAccess', () => {
  it('★ request 一次性整批申请两个 pattern', async () => {
    const { request } = stubPerms({});
    expect(await requestBroadHostAccess()).toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ['https://*/*', 'http://*/*'] });
  });

  it('用户拒绝 → false', async () => {
    stubPerms({ request: async () => false });
    expect(await requestBroadHostAccess()).toBe(false);
  });

  it('★ 手势失效（request 抛错）→ false，不抛穿', async () => {
    stubPerms({
      request: async () => {
        throw new Error('must be called during a user gesture');
      },
    });
    expect(await requestBroadHostAccess()).toBe(false);
  });

  it('非扩展环境 → false，不抛', async () => {
    expect(await requestBroadHostAccess()).toBe(false);
  });
});
